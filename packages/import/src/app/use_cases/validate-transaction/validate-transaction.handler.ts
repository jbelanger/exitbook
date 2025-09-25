import type { ClassifiedTransaction, MovementClassified } from '@crypto/core';
import { validateAllClassifiedMovements } from '@crypto/core';
import { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import { validateRequestId, createValidationFailedError, type ValidationFailedError } from '../../command-helpers.ts';

import type { ValidateTransactionCommand } from './validate-transaction.command.ts';

/**
 * Validation result for individual rules
 */
export interface ValidationResult {
  readonly isValid: boolean;
  readonly message: string;
  readonly rule: string;
  readonly violations?: string[] | undefined;
}

/**
 * Command Handler: Validate Classified Transaction Balance Rules
 *
 * Applies financial validation rules to classified movements to ensure
 * transaction integrity before storage.
 */
export async function validateTransactionCommand(
  command: ValidateTransactionCommand
): Promise<Result<ValidationResult[], ValidationFailedError>> {
  // 1. Validate command parameters
  const commandValidationResult = validateTransactionCommandParams(command);
  if (commandValidationResult.isErr()) {
    return err(commandValidationResult.error);
  }

  // 2. Apply balance validation rules
  const validationResults = validateTransactionRules(command.transaction);

  // 3. Check if any rules failed
  const failedRules = validationResults.filter((r) => !r.isValid);

  if (failedRules.length > 0) {
    const validationError = createValidationFailedError(
      failedRules.map((rule) => ({
        message: rule.message,
        rule: rule.rule,
        violations: rule.violations || [],
      })),
      {
        requestId: command.requestId,
        transactionId: command.transaction.id,
      }
    );

    return err(validationError);
  }

  // 4. All rules passed
  return Promise.resolve(ok(validationResults));
}

/**
 * Validate command parameters
 */
function validateTransactionCommandParams(command: ValidateTransactionCommand): Result<void, ValidationFailedError> {
  const requestIdValidation = validateRequestId(command.requestId, (message, context) =>
    createValidationFailedError([{ message, rule: 'COMMAND_VALIDATION', violations: [] }], context)
  );
  if (requestIdValidation.isErr()) {
    return requestIdValidation;
  }

  if (!command.transaction) {
    return err(
      createValidationFailedError(
        [
          {
            message: 'Transaction is required',
            rule: 'COMMAND_VALIDATION',
            violations: [],
          },
        ],
        { requestId: command.requestId }
      )
    );
  }

  if (!command.transaction.movements || command.transaction.movements.length === 0) {
    return err(
      createValidationFailedError(
        [
          {
            message: 'Transaction must have classified movements',
            rule: 'COMMAND_VALIDATION',
            violations: [],
          },
        ],
        {
          requestId: command.requestId,
          transactionId: command.transaction.id,
        }
      )
    );
  }

  // Use Core's validation for classified movements
  const movementValidation = validateAllClassifiedMovements(command.transaction.movements);
  if (movementValidation.isErr()) {
    return err(
      createValidationFailedError(
        [
          {
            message: movementValidation.error.message,
            rule: 'CLASSIFIED_MOVEMENTS_VALIDATION',
            violations: movementValidation.error.violations.flatMap((v) => v.violations || []),
          },
        ],
        {
          requestId: command.requestId,
          transactionId: command.transaction.id,
        }
      )
    );
  }

  return ok();
}

/**
 * Apply MVP balance validation rules
 */
function validateTransactionRules(transaction: ClassifiedTransaction): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Apply MVP balance rules
  results.push(validateFeesAndGasOut(transaction.movements));
  results.push(validateTradePrincipalsBalance(transaction.movements));
  results.push(validateTransferBalance(transaction.movements));

  return results;
}

/**
 * Rule: FEES_AND_GAS_OUT
 * All FEE and GAS movements must have direction 'OUT'
 */
function validateFeesAndGasOut(movements: MovementClassified[]): ValidationResult {
  const feesAndGas = movements.filter((m) => m.classification.purpose === 'FEE' || m.classification.purpose === 'GAS');

  const allOutbound = feesAndGas.every((m) => m.direction === 'OUT');

  return {
    isValid: allOutbound,
    message: allOutbound ? 'All fees and gas are OUT direction' : 'FEE and GAS must be OUT direction',
    rule: 'FEES_AND_GAS_OUT',
    violations: allOutbound
      ? undefined
      : feesAndGas
          .filter((m) => m.direction !== 'OUT')
          .map((m) => `Movement ${m.id} has ${m.classification.purpose} but direction ${m.direction}`),
  };
}

/**
 * Rule: TRADE_PRINCIPALS_BALANCE
 * For trades, PRINCIPAL movements must balance by currency
 */
function validateTradePrincipalsBalance(movements: MovementClassified[]): ValidationResult {
  const principals = movements.filter((m) => m.classification.purpose === 'PRINCIPAL');

  if (principals.length < 2) {
    return {
      isValid: true,
      message: 'No trade detected (less than 2 principals)',
      rule: 'TRADE_PRINCIPALS_BALANCE',
    };
  }

  // Group by currency and sum IN vs OUT
  const balances: Record<string, { in: Decimal; out: Decimal }> = {};

  for (const movement of principals) {
    const currency = movement.money.currency;
    if (!balances[currency]) {
      balances[currency] = { in: new Decimal(0), out: new Decimal(0) };
    }

    const amount = new Decimal(movement.money.amount);
    if (movement.direction === 'IN') {
      balances[currency].in = balances[currency].in.plus(amount);
    } else {
      balances[currency].out = balances[currency].out.plus(amount);
    }
  }

  // Trades: principals must net to zero by currency; fees are separate OUT
  const imbalances: string[] = [];
  for (const [currency, balance] of Object.entries(balances)) {
    if (!balance.in.equals(balance.out)) {
      imbalances.push(`${currency}: IN=${String(balance.in)} OUT=${String(balance.out)}`);
    }
  }

  return {
    isValid: imbalances.length === 0,
    message:
      imbalances.length === 0 ? 'Trade principals balance correctly' : 'Trade principals do not balance by currency',
    rule: 'TRADE_PRINCIPALS_BALANCE',
    violations: imbalances.length > 0 ? imbalances : undefined,
  };
}

/**
 * Rule: TRANSFER_BALANCE
 * For transfers, PRINCIPAL movements must net to zero in transferred currency
 */
function validateTransferBalance(movements: MovementClassified[]): ValidationResult {
  const principals = movements.filter((m) => m.classification.purpose === 'PRINCIPAL');
  const gas = movements.filter((m) => m.classification.purpose === 'GAS');

  // Transfers: transferred currency principals net to zero; GAS may net OUT in gas currency
  const principalBalances: Record<string, Decimal> = {};

  for (const movement of principals) {
    const currency = movement.money.currency;
    const amount = new Decimal(movement.money.amount);
    const signedAmount = movement.direction === 'IN' ? amount : amount.neg();

    principalBalances[currency] = (principalBalances[currency] || new Decimal(0)).plus(signedAmount);
  }

  // Check if this looks like a transfer (single currency principals net zero)
  const principalCurrencies = Object.keys(principalBalances);
  if (principalCurrencies.length !== 1) {
    return {
      isValid: true,
      message: 'Not a simple transfer (multiple principal currencies)',
      rule: 'TRANSFER_BALANCE',
    };
  }

  const [transferCurrency] = principalCurrencies;
  const principalBalance = principalBalances[transferCurrency];

  const isBalanced = principalBalance.equals(0);
  const gasOk = gas.every((g) => g.direction === 'OUT');

  return {
    isValid: isBalanced && gasOk,
    message:
      isBalanced && gasOk
        ? 'Transfer balances correctly'
        : `Transfer invalid: principals=${principalBalance.toString()}, gas directions OK=${gasOk}`,
    rule: 'TRANSFER_BALANCE',
    violations:
      !isBalanced || !gasOk
        ? [
            `Principal balance: ${principalBalance.toString()} ${transferCurrency}`,
            `Gas directions: ${gas.map((g) => `${g.direction}`).join(', ')}`,
          ]
        : undefined,
  };
}
