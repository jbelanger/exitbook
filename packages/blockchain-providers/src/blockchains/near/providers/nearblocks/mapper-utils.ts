import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.ts';
import { validateOutput } from '../../../../core/index.ts';
import type { NearAction, NearAccountChange, NearTokenTransfer, NearTransaction } from '../../schemas.ts';
import { NearAccountChangeSchema, NearTokenTransferSchema, NearTransactionSchema } from '../../schemas.ts';
import { yoctoNearToNearString } from '../../utils.ts';

import {
  NearBlocksActivitySchema,
  NearBlocksFtTransactionSchema,
  type NearBlocksActivity,
  type NearBlocksFtTransaction,
  type NearBlocksTransaction,
} from './nearblocks.schemas.js';

/**
 * Pure functions for NearBlocks transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Parse NearBlocks timestamp to Unix timestamp (milliseconds)
 * NearBlocks timestamps are in nanoseconds (string format)
 * Returns milliseconds for compatibility with JavaScript Date constructor and UniversalTransactionData schema
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
    deposit?: string | undefined;
    fee?: string | undefined;
    method?: string | null | undefined;
  }[]
): NearAction[] {
  if (!actions || actions.length === 0) {
    return [];
  }

  return actions.map((action) => ({
    actionType: action.action,
    args: typeof action.args === 'object' && action.args !== null ? action.args : undefined,
    deposit: action.deposit,
    methodName: action.method ?? undefined,
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
    if (action.deposit !== undefined) {
      total = total.add(parseDecimal(action.deposit));
    }
  }

  return total.toFixed();
}

/**
 * Calculate total gas burnt from receipt outcome
 */
export function calculateTotalGasBurnt(receiptOutcome?: {
  executor_account_id: string;
  gas_burnt: string;
  status: boolean;
  tokens_burnt: string;
}): string | undefined {
  if (!receiptOutcome) {
    return undefined;
  }

  return parseDecimal(receiptOutcome.tokens_burnt).toFixed();
}

/**
 * Convert NearBlocks activity to NearAccountChange
 * Stores amounts in yoctoNEAR (smallest units) for precise arithmetic
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
      message: `Invalid NearBlocksActivity input: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  const validatedActivity = inputValidationResult.data;

  // NearBlocks provides two pieces of data:
  // 1. absolute_nonstaked_amount: The total balance after the event
  // 2. delta_nonstaked_amount: The signed change for that event (optional)
  // We need to use delta_nonstaked_amount (when available) to compute the correct pre/post balances
  const postBalanceYocto = validatedActivity.absolute_nonstaked_amount;

  let signedDeltaYocto: string;
  if (validatedActivity.delta_nonstaked_amount !== undefined) {
    // Use the delta provided by the API (already signed)
    signedDeltaYocto = validatedActivity.delta_nonstaked_amount;
  } else {
    // Fallback: when delta data is missing we cannot safely infer the previous
    // balance. Emit a zero delta instead of assuming the entire balance moved.
    signedDeltaYocto = '0';
  }

  // Calculate preBalance = postBalance - signedDelta (no-op when signed delta is zero)
  const preBalanceYocto = parseDecimal(postBalanceYocto).sub(parseDecimal(signedDeltaYocto)).toFixed(0);

  // For account changes, we store amounts in yoctoNEAR (smallest units)
  // preBalance: balance before the transaction
  // postBalance: balance after the transaction (from absolute_nonstaked_amount)
  // The processor layer calculates delta = postBalance - preBalance for precise BigInt arithmetic
  const accountChange: NearAccountChange = {
    account: accountId,
    postBalance: postBalanceYocto,
    preBalance: preBalanceYocto,
  };

  // Validate output data
  const outputValidationResult = NearAccountChangeSchema.safeParse(accountChange);
  if (!outputValidationResult.success) {
    const errors = outputValidationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
      return `${issue.message}${path}`;
    });
    return err({
      message: `Invalid NearAccountChange output: ${errors.join(', ')}`,
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
      message: `Invalid NearBlocksFtTransaction input: ${errors.join(', ')}`,
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
  const deltaAmount = parseDecimal(rawAmount);
  const normalizedAmount = deltaAmount.div(parseDecimal('10').pow(decimals));

  // Determine direction using the delta sign; NearBlocks always returns the queried
  // account as affected_account_id and uses a negative delta for outbound transfers.
  const hasPositiveDelta = deltaAmount.greaterThan(0);
  const hasNegativeDelta = deltaAmount.lessThan(0);

  let from: string | undefined;
  let to: string | undefined;

  if (hasPositiveDelta) {
    from = validatedFtTx.involved_account_id || validatedFtTx.ft.contract;
    to = accountId;
  } else if (hasNegativeDelta) {
    from = accountId;
    to = validatedFtTx.involved_account_id || validatedFtTx.ft.contract;
  } else {
    // Fallback to previous heuristic when NearBlocks does not provide a direction signal.
    const affectedAccountMatchesQuery = validatedFtTx.affected_account_id === accountId;
    from = affectedAccountMatchesQuery ? validatedFtTx.involved_account_id || validatedFtTx.ft.contract : accountId;
    to = affectedAccountMatchesQuery ? accountId : validatedFtTx.involved_account_id || validatedFtTx.ft.contract;
  }

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
      message: `Invalid NearTokenTransfer output: ${errors.join(', ')}`,
      type: 'error',
    });
  }

  return ok(tokenTransfer);
}

/**
 * Map NearBlocks transaction to normalized NearTransaction
 * Input data is pre-validated by HTTP client schema validation
 */
export function mapNearBlocksTransaction(rawData: NearBlocksTransaction): Result<NearTransaction, NormalizationError> {
  const validatedRawData = rawData;

  const timestamp = parseNearBlocksTimestamp(validatedRawData.block_timestamp);
  const status = determineTransactionStatus(validatedRawData.outcomes);
  const actions = mapNearBlocksActions(validatedRawData.actions);
  const totalDeposit = calculateTotalDeposit(validatedRawData.actions);
  const totalGasBurnt = calculateTotalGasBurnt(validatedRawData.receipt_outcome);

  // Fallback: use aggregated transaction fee when receipt outcome is missing
  let feeYocto = totalGasBurnt;
  if ((!feeYocto || feeYocto === '0') && validatedRawData.outcomes_agg?.transaction_fee) {
    feeYocto = validatedRawData.outcomes_agg.transaction_fee.toString();
  }

  // Determine transaction type based on actions
  const hasTransferAction = actions.some((a) => a.actionType === 'TRANSFER' || a.actionType === 'Transfer');
  const hasFunctionCall = actions.some((a) => a.actionType === 'FUNCTION_CALL' || a.actionType === 'FunctionCall');

  let type: 'transfer' | 'token_transfer' | 'contract_call' = 'contract_call';
  if (hasTransferAction && !hasFunctionCall) {
    type = 'transfer';
  } else if (hasFunctionCall) {
    type = 'contract_call';
  }

  const normalized: NearTransaction = {
    actions,
    amount: totalDeposit,
    currency: 'NEAR',
    from: validatedRawData.signer_account_id,
    id: validatedRawData.transaction_hash,
    providerName: 'nearblocks',
    status,
    timestamp,
    to: validatedRawData.receiver_account_id,
    type,
  };

  if (validatedRawData.block?.block_height) {
    normalized.blockHeight = validatedRawData.block.block_height;
  }

  if (feeYocto && feeYocto !== '0') {
    normalized.feeAmount = yoctoNearToNearString(feeYocto);
    normalized.feeCurrency = 'NEAR';
  }

  return validateOutput(normalized, NearTransactionSchema, 'NearBlocksTransaction');
}
