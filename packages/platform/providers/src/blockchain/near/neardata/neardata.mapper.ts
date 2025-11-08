import type { SourceMetadata } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { NearTransactionSchema, type NearAction, type NearTransaction } from '../schemas.js';

import { NearDataTransactionSchema, type NearDataTransaction } from './neardata.schemas.js';

/**
 * Pure functions for NearData transaction mapping
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
 * Parse NearData timestamp to Unix timestamp (milliseconds)
 * NearData timestamps are in nanoseconds (number format)
 * Returns milliseconds for compatibility with JavaScript Date constructor and UniversalTransaction schema
 */
export function parseNearDataTimestamp(timestamp: number): number {
  // Convert nanoseconds to milliseconds (divide by 1,000,000)
  const nanoseconds = parseDecimal(timestamp.toString());
  const milliseconds = nanoseconds.div(parseDecimal('1000000'));
  return parseInt(milliseconds.toFixed(0), 10);
}

/**
 * Determine transaction status from NearData outcome
 */
export function determineTransactionStatus(
  outcome:
    | {
        execution_outcome?:
          | {
              outcome: {
                status: { SuccessValue: string } | { SuccessReceiptId: string } | { Failure: unknown };
              };
            }
          | undefined;
      }
    | undefined
): 'success' | 'failed' | 'pending' {
  if (!outcome?.execution_outcome) {
    return 'pending';
  }

  const status = outcome.execution_outcome.outcome.status;

  if ('SuccessValue' in status || 'SuccessReceiptId' in status) {
    return 'success';
  }

  if ('Failure' in status) {
    return 'failed';
  }

  return 'pending';
}

/**
 * Map NearData actions to normalized NEAR actions
 */
export function mapNearDataActions(
  actions?: {
    action_kind: string;
    args?: Record<string, unknown> | string | null | undefined;
    deposit?: string | undefined;
    gas?: number | undefined;
    method_name?: string | null | undefined;
  }[]
): NearAction[] {
  if (!actions || actions.length === 0) {
    return [];
  }

  return actions.map((action) => ({
    actionType: action.action_kind,
    args: typeof action.args === 'object' && action.args !== null ? action.args : undefined,
    deposit: action.deposit,
    gas: action.gas?.toString(),
    methodName: action.method_name ?? undefined,
    receiverId: undefined,
  }));
}

/**
 * Calculate total deposit amount from actions
 */
export function calculateTotalDeposit(actions?: { deposit?: string | undefined }[]): string {
  if (!actions || actions.length === 0) {
    return '0';
  }

  let total = parseDecimal('0');
  for (const action of actions) {
    if (action.deposit) {
      total = total.add(parseDecimal(action.deposit));
    }
  }

  return total.toFixed();
}

/**
 * Calculate total gas burnt from execution outcome
 */
export function calculateTotalGasBurnt(
  outcome:
    | {
        execution_outcome?:
          | {
              outcome: {
                tokens_burnt: string;
              };
            }
          | undefined;
      }
    | undefined
): string | undefined {
  if (!outcome?.execution_outcome) {
    return undefined;
  }

  return parseDecimal(outcome.execution_outcome.outcome.tokens_burnt).toFixed();
}

/**
 * Map NearData transaction to normalized NearTransaction
 */
export function mapNearDataTransaction(
  rawData: NearDataTransaction,
  sourceContext: SourceMetadata
): Result<NearTransaction, NormalizationError> {
  // Validate input data
  const inputValidationResult = NearDataTransactionSchema.safeParse(rawData);
  if (!inputValidationResult.success) {
    const errors = inputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid NearData transaction input data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  const validatedRawData = inputValidationResult.data;

  const timestamp = parseNearDataTimestamp(validatedRawData.block_timestamp);
  const status = determineTransactionStatus(validatedRawData.outcome);
  const actions = mapNearDataActions(validatedRawData.actions);
  const totalDeposit = calculateTotalDeposit(validatedRawData.actions);
  const totalGasBurnt = calculateTotalGasBurnt(validatedRawData.outcome);

  const normalized: NearTransaction = {
    actions,
    amount: totalDeposit,
    currency: 'NEAR',
    from: validatedRawData.signer_id,
    id: validatedRawData.tx_hash,
    providerName: (sourceContext.providerName as string | undefined) || 'neardata',
    status,
    timestamp,
    to: validatedRawData.receiver_id,
  };

  if (validatedRawData.block_height) {
    normalized.blockHeight = validatedRawData.block_height;
  }

  if (validatedRawData.block_hash) {
    normalized.blockId = validatedRawData.block_hash;
  }

  if (totalGasBurnt && totalGasBurnt !== '0') {
    normalized.feeAmount = yoctoNearToNearString(totalGasBurnt);
    normalized.feeCurrency = 'NEAR';
  }

  // Validate output data
  const outputValidationResult = NearTransactionSchema.safeParse(normalized);
  if (!outputValidationResult.success) {
    const errors = outputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid NearData transaction output data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  return ok(normalized);
}
