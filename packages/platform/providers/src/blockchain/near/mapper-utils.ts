import type { SourceMetadata } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../shared/blockchain/index.js';

import {
  NearBlocksActivitySchema,
  NearBlocksFtTransactionSchema,
  NearBlocksTransactionSchema,
  type NearBlocksActivity,
  type NearBlocksFtTransaction,
  type NearBlocksTransaction,
} from './nearblocks/nearblocks.schemas.js';
import {
  NearAccountChangeSchema,
  NearTokenTransferSchema,
  NearTransactionSchema,
  type NearAccountChange,
  type NearAction,
  type NearTokenTransfer,
  type NearTransaction,
} from './schemas.js';

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
export function determineTransactionStatus(outcomes?: { status: boolean }): 'success' | 'failed' | 'pending' {
  if (!outcomes) {
    return 'pending';
  }

  return outcomes.status ? 'success' : 'failed';
}

/**
 * Map NearBlocks actions to normalized NEAR actions
 */
export function mapNearBlocksActions(
  actions?: {
    action: string;
    args?: Record<string, unknown> | string | null | undefined;
    deposit?: number | undefined;
    fee?: number | undefined;
    method?: string | null | undefined;
  }[]
): NearAction[] {
  if (!actions || actions.length === 0) {
    return [];
  }

  return actions.map((action) => ({
    actionType: action.action,
    args: typeof action.args === 'object' && action.args !== null ? action.args : undefined,
    deposit: action.deposit?.toString(),
    methodName: action.method ?? undefined,
    receiverId: undefined,
  }));
}

/**
 * Calculate total deposit amount from actions
 */
export function calculateTotalDeposit(actions?: { deposit?: number | undefined }[]): string {
  if (!actions || actions.length === 0) {
    return '0';
  }

  let total = parseDecimal('0');
  for (const action of actions) {
    if (action.deposit) {
      total = total.add(parseDecimal(action.deposit.toString()));
    }
  }

  return total.toFixed();
}

/**
 * Calculate total gas burnt from receipt outcome
 */
export function calculateTotalGasBurnt(receiptOutcome?: {
  executor_account_id: string;
  gas_burnt: number;
  status: boolean;
  tokens_burnt: number;
}): string | undefined {
  if (!receiptOutcome) {
    return undefined;
  }

  return parseDecimal(receiptOutcome.tokens_burnt.toString()).toFixed();
}

/**
 * Convert NearBlocks activity to NearAccountChange
 * Handles yocto to NEAR conversion and computes signed deltas
 */
export function mapNearBlocksActivityToAccountChange(
  activity: NearBlocksActivity,
  accountId: string
): Result<NearAccountChange, NormalizationError> {
  // Validate input data
  const inputValidationResult = NearBlocksActivitySchema.safeParse(activity);
  if (!inputValidationResult.success) {
    const errors = inputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid NearBlocks activity input data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  const validatedActivity = inputValidationResult.data;

  // Convert yoctoNEAR to NEAR
  const absoluteAmount = yoctoNearToNearString(validatedActivity.absolute_nonstaked_amount);

  // Compute signed delta based on direction
  // INBOUND means the account received NEAR (positive delta)
  // OUTBOUND means the account sent NEAR (negative delta)
  const delta = parseDecimal(absoluteAmount);
  const signedDelta = validatedActivity.direction === 'INBOUND' ? delta : delta.negated();

  // For account changes, we need preBalance and postBalance
  // Since the API only provides absolute amounts and direction, we synthesize these
  // preBalance = 0 (we don't have historical balance)
  // postBalance = signed delta (representing the change)
  // Note: The importer layer should aggregate these to compute actual pre/post balances
  const accountChange: NearAccountChange = {
    account: accountId,
    postBalance: signedDelta.toFixed(),
    preBalance: '0',
  };

  // Validate output data
  const outputValidationResult = NearAccountChangeSchema.safeParse(accountChange);
  if (!outputValidationResult.success) {
    const errors = outputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid NearAccountChange output data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  return ok(accountChange);
}

/**
 * Convert NearBlocks FT transaction to NearTokenTransfer
 * Normalizes amounts by decimals and handles missing symbols
 */
export function mapNearBlocksFtTransactionToTokenTransfer(
  ftTx: NearBlocksFtTransaction,
  accountId: string
): Result<NearTokenTransfer, NormalizationError> {
  // Validate input data
  const inputValidationResult = NearBlocksFtTransactionSchema.safeParse(ftTx);
  if (!inputValidationResult.success) {
    const errors = inputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid NearBlocks FT transaction input data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  const validatedFtTx = inputValidationResult.data;

  // Ensure we have FT metadata
  if (!validatedFtTx.ft) {
    return err({
      message: 'FT transaction missing token metadata',
      type: 'error',
    });
  }

  // Normalize amount by decimals
  const rawAmount = validatedFtTx.delta_amount || '0';
  const decimals = validatedFtTx.ft.decimals;
  const normalizedAmount = parseDecimal(rawAmount).div(parseDecimal('10').pow(decimals));

  // Determine from/to based on affected_account_id and involved_account_id
  // If affected_account_id matches the queried account, they are the receiver (INBOUND)
  // If involved_account_id matches the queried account, they are the sender (OUTBOUND)
  const isInbound = validatedFtTx.affected_account_id === accountId;
  const from = isInbound ? validatedFtTx.involved_account_id || validatedFtTx.ft.contract : accountId;
  const to = isInbound ? accountId : validatedFtTx.involved_account_id || validatedFtTx.ft.contract;

  const tokenTransfer: NearTokenTransfer = {
    amount: normalizedAmount.abs().toFixed(),
    contractAddress: validatedFtTx.ft.contract,
    decimals: validatedFtTx.ft.decimals,
    from,
    symbol: validatedFtTx.ft.symbol,
    to,
  };

  // Validate output data
  const outputValidationResult = NearTokenTransferSchema.safeParse(tokenTransfer);
  if (!outputValidationResult.success) {
    const errors = outputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid NearTokenTransfer output data: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  return ok(tokenTransfer);
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
  const totalGasBurnt = calculateTotalGasBurnt(validatedRawData.receipt_outcome);

  const normalized: NearTransaction = {
    actions,
    amount: totalDeposit,
    currency: 'NEAR',
    from: validatedRawData.predecessor_account_id,
    id: validatedRawData.transaction_hash,
    providerName: (sourceContext.providerName as string | undefined) || 'nearblocks',
    status,
    timestamp,
    to: validatedRawData.receiver_account_id,
  };

  if (validatedRawData.block?.block_height) {
    normalized.blockHeight = validatedRawData.block.block_height;
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
