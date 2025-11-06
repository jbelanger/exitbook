import type { SourceMetadata } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../shared/blockchain/index.js';

import type { NearBlocksTransaction } from './nearblocks/nearblocks.schemas.js';
import type { NearAction, NearTransaction } from './schemas.js';

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
 * Parse NearBlocks timestamp to Unix timestamp (seconds)
 * NearBlocks timestamps are in nanoseconds (string format)
 * Returns seconds for compatibility with UniversalTransaction schema
 */
export function parseNearBlocksTimestamp(timestamp: string): number {
  // Convert nanoseconds to seconds
  const nanoseconds = parseDecimal(timestamp);
  const seconds = nanoseconds.div(parseDecimal('1000000000'));
  return parseInt(seconds.toFixed(0), 10);
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
  actions?:
    | {
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
export function calculateTotalDeposit(actions?: { deposit?: string | undefined }[]  ): string {
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
  const timestamp = parseNearBlocksTimestamp(rawData.block_timestamp);
  const status = determineTransactionStatus(rawData.outcomes);
  const actions = mapNearBlocksActions(rawData.actions);
  const totalDeposit = calculateTotalDeposit(rawData.actions);
  const totalGasBurnt = calculateTotalGasBurnt(rawData.outcomes);

  const normalized: NearTransaction = {
    actions,
    amount: totalDeposit,
    currency: 'NEAR',
    from: rawData.signer_id,
    id: rawData.transaction_hash,
    providerName: (sourceContext.providerName as string | undefined) || 'nearblocks',
    status,
    timestamp,
    to: rawData.receiver_id,
  };

  if (rawData.block_height) {
    normalized.blockHeight = rawData.block_height;
  }

  if (totalGasBurnt && totalGasBurnt !== '0') {
    normalized.feeAmount = yoctoNearToNearString(totalGasBurnt);
    normalized.feeCurrency = 'NEAR';
  }

  return ok(normalized);
}
