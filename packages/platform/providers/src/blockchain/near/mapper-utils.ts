import type { SourceMetadata } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../shared/blockchain/index.js';

import { NearBlocksTransactionSchema, type NearBlocksTransaction } from './nearblocks/nearblocks.schemas.js';
import { NearTransactionSchema, type NearAction, type NearTransaction } from './schemas.js';

/**
 * Pure functions for NEAR transaction mapping
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
 * Parse NearBlocks timestamp to Unix timestamp (milliseconds)
 * NearBlocks timestamps are in nanoseconds (string format)
 * Returns milliseconds for compatibility with JavaScript Date constructor and UniversalTransaction schema
 */
export function parseNearBlocksTimestamp(timestamp: string): number {
  // Convert nanoseconds to milliseconds (divide by 1,000,000)
  const nanoseconds = parseDecimal(timestamp);
  const milliseconds = nanoseconds.div(parseDecimal('1000000'));
  return parseInt(milliseconds.toFixed(0), 10);
}

/**
 * Determine transaction status from NearBlocks outcomes
 */
export function determineTransactionStatus(
  outcomes?: Record<string, { status: boolean | Record<string, unknown> }>
): 'success' | 'failed' | 'pending' {
  if (!outcomes || Object.keys(outcomes).length === 0) {
    return 'pending';
  }

  // Check all outcomes - if any failed, transaction failed
  for (const outcome of Object.values(outcomes)) {
    if (typeof outcome.status === 'boolean') {
      if (!outcome.status) return 'failed';
    } else if (typeof outcome.status === 'object') {
      // If status is an object, check for SuccessValue or Failure
      if ('Failure' in outcome.status) return 'failed';
    }
  }

  return 'success';
}

/**
 * Map NearBlocks actions to normalized NEAR actions
 */
export function mapNearBlocksActions(
  actions?: {
    action: string;
    args?: Record<string, unknown> | undefined;
    deposit?: string | undefined;
    from: string;
    method?: string | undefined;
    to: string;
  }[]
): NearAction[] {
  if (!actions || actions.length === 0) {
    return [];
  }

  return actions.map((action) => ({
    actionType: action.action,
    args: action.args,
    deposit: action.deposit,
    methodName: action.method,
    receiverId: action.to,
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
 * Calculate total gas burnt from outcomes
 */
export function calculateTotalGasBurnt(
  outcomes?: Record<string, { gas_burnt?: number | undefined; tokens_burnt?: string | undefined }>
): string | undefined {
  if (!outcomes || Object.keys(outcomes).length === 0) {
    return undefined;
  }

  let totalTokensBurnt = parseDecimal('0');
  for (const outcome of Object.values(outcomes)) {
    if (outcome.tokens_burnt) {
      totalTokensBurnt = totalTokensBurnt.add(parseDecimal(outcome.tokens_burnt));
    }
  }

  return totalTokensBurnt.toFixed();
}

/**
 * Map NearBlocks transaction to normalized NearTransaction
 */
export function mapNearBlocksTransaction(
  rawData: NearBlocksTransaction,
  sourceContext: SourceMetadata
): Result<NearTransaction, NormalizationError> {
  // Validate input data
  const inputValidationResult = NearBlocksTransactionSchema.safeParse(rawData);
  if (!inputValidationResult.success) {
    const errors = inputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid NearBlocks transaction input data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  const validatedRawData = inputValidationResult.data;

  const timestamp = parseNearBlocksTimestamp(validatedRawData.block_timestamp);
  const status = determineTransactionStatus(validatedRawData.outcomes);
  const actions = mapNearBlocksActions(validatedRawData.actions);
  const totalDeposit = calculateTotalDeposit(validatedRawData.actions);
  const totalGasBurnt = calculateTotalGasBurnt(validatedRawData.outcomes);

  const normalized: NearTransaction = {
    actions,
    amount: totalDeposit,
    currency: 'NEAR',
    from: validatedRawData.signer_id,
    id: validatedRawData.transaction_hash,
    providerName: (sourceContext.providerName as string | undefined) || 'nearblocks',
    status,
    timestamp,
    to: validatedRawData.receiver_id,
  };

  if (validatedRawData.block_height) {
    normalized.blockHeight = validatedRawData.block_height;
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
      message: `Invalid NearBlocks transaction output data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  return ok(normalized);
}
