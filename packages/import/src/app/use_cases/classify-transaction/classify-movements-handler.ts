import type {
  ProcessedTransaction,
  ClassifiedTransaction,
  MovementUnclassified,
  ClassificationInfo,
} from '@crypto/core';
import { validateTransactionHasMovements, validateSupportedSource, createMovementClassified } from '@crypto/core';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import { validateRequestId, createClassificationError, type ClassificationError } from '../../command-helpers.ts';

import type { ClassifyMovementsCommand } from './classify-movements-command.ts';

/**
 * Command Handler: Classify Transaction Movements by Purpose
 *
 * Applies purpose classification rules to unclassified movements in a ProcessedTransaction,
 * producing ClassifiedTransaction with PRINCIPAL/FEE/GAS assignments.
 */
export async function classifyMovementsCommand(
  command: ClassifyMovementsCommand
): Promise<Result<ClassifiedTransaction, ClassificationError>> {
  // 1. Validate command parameters
  const validationResult = validateClassifyMovementsCommand(command);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  // 2. Apply classification rules to each movement
  const classificationResult = await classifyTransactionMovements(command);
  if (classificationResult.isErr()) {
    return classificationResult;
  }

  return ok(classificationResult.value);
}

/**
 * Validate command parameters
 */
function validateClassifyMovementsCommand(command: ClassifyMovementsCommand): Result<void, ClassificationError> {
  const requestIdValidation = validateRequestId(command.requestId, (message, context) =>
    createClassificationError(message, [], context)
  );
  if (requestIdValidation.isErr()) {
    return requestIdValidation;
  }

  // Validate required fields
  if (!command.transaction) {
    return err(createClassificationError('Transaction is required', [], { requestId: command.requestId }));
  }

  // Use Core's validation functions
  const movementsValidation = validateTransactionHasMovements(command.transaction);
  if (movementsValidation.isErr()) {
    return err(
      createClassificationError(movementsValidation.error.message, [], {
        requestId: command.requestId,
        transactionId: command.transaction.id,
      })
    );
  }

  const sourceValidation = validateSupportedSource(command.transaction.source);
  if (sourceValidation.isErr()) {
    return err(
      createClassificationError(
        sourceValidation.error.message,
        command.transaction.movements.map((m) => m.id),
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
 * Apply classification rules to transaction movements
 */
async function classifyTransactionMovements(
  command: ClassifyMovementsCommand
): Promise<Result<ClassifiedTransaction, ClassificationError>> {
  const transaction = command.transaction;
  const rulesetVersion = command.rulesetVersion || '1.0.0';

  // Apply classification rules to each movement
  const classifiedMovements = [];

  for (const movement of transaction.movements) {
    const classification = classifyMovement(movement, transaction, rulesetVersion);
    const classifiedMovement = createMovementClassified(movement, classification);
    classifiedMovements.push(classifiedMovement);
  }

  const classifiedTransaction: ClassifiedTransaction = {
    id: transaction.id,
    movements: classifiedMovements,
    purposeRulesetVersion: rulesetVersion,
    source: transaction.source,
    timestamp: transaction.timestamp,
  };

  return Promise.resolve(ok(classifiedTransaction));
}

/**
 * Classify individual movement using MVP classification rules
 */
function classifyMovement(
  movement: MovementUnclassified,
  transaction: ProcessedTransaction,
  rulesetVersion: string
): ClassificationInfo {
  // MVP classification rules (simplified version)
  // In production, this would be delegated to the PurposeClassifier service

  // Rule 1: Exchange trading fees
  if (
    transaction.source.kind === 'exchange' &&
    transaction.source.venue === 'kraken' &&
    movement.hint === 'FEE' &&
    movement.direction === 'OUT'
  ) {
    return {
      classifiedAt: new Date().toISOString(),
      confidence: 1.0,
      purpose: 'FEE' as const,
      reason: 'Kraken trading fee',
      ruleId: 'exchange.kraken.trade.fee.v1',
      version: rulesetVersion,
    };
  }

  // Rule 2: Ethereum gas fees
  if (
    transaction.source.kind === 'blockchain' &&
    transaction.source.chain === 'ethereum' &&
    movement.hint === 'GAS' &&
    movement.direction === 'OUT' &&
    movement.money.currency === 'ETH'
  ) {
    return {
      classifiedAt: new Date().toISOString(),
      confidence: 1.0,
      purpose: 'GAS' as const,
      reason: 'Ethereum gas fee',
      ruleId: 'chain.eth.transfer.gas.v1',
      version: rulesetVersion,
    };
  }

  // Rule 3: Principal movements (default for everything without hints)
  if (!movement.hint) {
    let ruleId: string;
    let reason: string;

    if (transaction.source.kind === 'exchange') {
      ruleId = 'exchange.kraken.trade.principal.v1';
      reason = 'Kraken trade principal movement';
    } else {
      ruleId = 'chain.eth.transfer.principal.v1';
      reason = 'Ethereum transfer principal';
    }

    return {
      classifiedAt: new Date().toISOString(),
      confidence: 1.0,
      purpose: 'PRINCIPAL' as const,
      reason,
      ruleId,
      version: rulesetVersion,
    };
  }

  // Fallback - should not reach here in MVP
  return {
    classifiedAt: new Date().toISOString(),
    confidence: 0.5,
    purpose: 'PRINCIPAL' as const,
    reason: 'Fallback principal classification',
    ruleId: 'fallback.principal.v1',
    version: rulesetVersion,
  };
}
