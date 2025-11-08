import type { SourceMetadata } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { NearTransactionSchema, type NearAction, type NearTransaction } from '../schemas.js';

import {
  FastNearExplorerTransactionDataSchema,
  type FastNearExplorerAction,
  type FastNearExplorerTransactionData,
} from './fastnear.schemas.js';

/**
 * Pure functions for FastNear Explorer transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Convert yoctoNEAR to NEAR as a string
 * 1 NEAR = 10^24 yoctoNEAR
 */
export function yoctoNearToNearString(yoctoNear: string | number): string {
  return parseDecimal(yoctoNear.toString()).div(parseDecimal('10').pow(24)).toFixed();
}

/**
 * Parse FastNear timestamp to Unix timestamp (milliseconds)
 * FastNear timestamps are in nanoseconds
 * Returns milliseconds for compatibility with JavaScript Date constructor and UniversalTransaction schema
 */
export function parseFastNearTimestamp(timestamp: number): number {
  const nanoseconds = parseDecimal(timestamp.toString());
  const milliseconds = nanoseconds.div(parseDecimal('1000000'));
  return parseInt(milliseconds.toFixed(0), 10);
}

/**
 * Determine transaction status from FastNear execution outcome
 */
export function determineTransactionStatus(
  outcome: FastNearExplorerTransactionData['execution_outcome']
): 'success' | 'failed' | 'pending' {
  if (!outcome) {
    return 'pending';
  }

  const status = outcome.outcome.status;

  if ('SuccessValue' in status || 'SuccessReceiptId' in status) {
    return 'success';
  }

  if ('Failure' in status) {
    return 'failed';
  }

  return 'pending';
}

/**
 * Map FastNear Explorer actions to normalized NEAR actions
 */
export function mapFastNearExplorerActions(actions: FastNearExplorerAction[]): NearAction[] {
  return actions.map((action) => {
    if (typeof action === 'string') {
      return {
        actionType: action,
      };
    }

    if ('FunctionCall' in action) {
      return {
        actionType: 'FunctionCall',
        args: { encoded_args: action.FunctionCall.args },
        deposit: action.FunctionCall.deposit,
        gas: action.FunctionCall.gas.toString(),
        methodName: action.FunctionCall.method_name,
      };
    }

    if ('Transfer' in action) {
      return {
        actionType: 'Transfer',
        deposit: action.Transfer.deposit,
      };
    }

    if ('AddKey' in action) {
      return {
        actionType: 'AddKey',
        publicKey: action.AddKey.public_key,
      };
    }

    if ('DeleteKey' in action) {
      return {
        actionType: 'DeleteKey',
        publicKey: action.DeleteKey.public_key,
      };
    }

    if ('Stake' in action) {
      return {
        actionType: 'Stake',
        deposit: action.Stake.stake,
        publicKey: action.Stake.public_key,
      };
    }

    if ('DeployContract' in action) {
      return {
        actionType: 'DeployContract',
      };
    }

    if ('DeleteAccount' in action) {
      return {
        actionType: 'DeleteAccount',
      };
    }

    return {
      actionType: 'Unknown',
    };
  });
}

/**
 * Calculate total deposit amount from actions
 */
export function calculateTotalDeposit(actions: FastNearExplorerAction[]): string {
  let total = parseDecimal('0');

  for (const action of actions) {
    if (typeof action === 'object') {
      if ('Transfer' in action && action.Transfer.deposit) {
        total = total.add(parseDecimal(action.Transfer.deposit));
      } else if ('FunctionCall' in action && action.FunctionCall.deposit) {
        total = total.add(parseDecimal(action.FunctionCall.deposit));
      } else if ('Stake' in action && action.Stake.stake) {
        total = total.add(parseDecimal(action.Stake.stake));
      }
    }
  }

  return total.toFixed();
}

/**
 * Map FastNear Explorer transaction to normalized NearTransaction
 */
export function mapFastNearExplorerTransaction(
  rawData: FastNearExplorerTransactionData,
  accountTxMetadata: { tx_block_height: number; tx_block_timestamp: number },
  sourceContext: SourceMetadata
): Result<NearTransaction, NormalizationError> {
  const inputValidationResult = FastNearExplorerTransactionDataSchema.safeParse(rawData);
  if (!inputValidationResult.success) {
    const errors = inputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid FastNear Explorer transaction input data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  const validatedRawData = inputValidationResult.data;
  const { transaction, execution_outcome } = validatedRawData;

  const timestamp = parseFastNearTimestamp(accountTxMetadata.tx_block_timestamp);
  const status = determineTransactionStatus(execution_outcome);
  const actions = mapFastNearExplorerActions(transaction.actions);
  const totalDeposit = calculateTotalDeposit(transaction.actions);

  const normalized: NearTransaction = {
    actions,
    amount: totalDeposit,
    blockHeight: accountTxMetadata.tx_block_height,
    blockId: execution_outcome.block_hash,
    currency: 'NEAR',
    from: transaction.signer_id,
    id: transaction.hash,
    providerName: (sourceContext.providerName as string | undefined) || 'fastnear',
    status,
    timestamp,
    to: transaction.receiver_id,
  };

  const tokensBurnt = execution_outcome.outcome.tokens_burnt;
  if (tokensBurnt && tokensBurnt !== '0') {
    normalized.feeAmount = yoctoNearToNearString(tokensBurnt);
    normalized.feeCurrency = 'NEAR';
  }

  const outputValidationResult = NearTransactionSchema.safeParse(normalized);
  if (!outputValidationResult.success) {
    const errors = outputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid FastNear Explorer transaction output data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  return ok(normalized);
}
