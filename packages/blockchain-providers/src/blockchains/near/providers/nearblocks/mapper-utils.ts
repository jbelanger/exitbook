/**
 * Mapper utilities for converting raw NearBlocks data to normalized NEAR types
 *
 * These mappers are used by the API client to convert raw provider data
 * to provider-agnostic normalized types before storage.
 *
 * Architecture:
 * - Normalization happens at API client level (not processor)
 * - Maps to provider-agnostic types defined in schemas.ts
 * - No correlation logic (correlation happens in processor)
 */

import { createHash } from 'node:crypto';

import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import type {
  NearTransaction,
  NearReceipt,
  NearReceiptAction,
  NearBalanceChange,
  NearTokenTransfer,
  NearBalanceChangeCause,
  NearActionType,
} from '../../schemas.ts';
import { NearActionTypeSchema } from '../../schemas.ts';

import type {
  NearBlocksTransaction,
  NearBlocksReceipt,
  NearBlocksAction,
  NearBlocksActivity,
  NearBlocksFtTransaction,
} from './nearblocks.schemas.ts';

const logger = getLogger('nearblocks-mapper');

/**
 * Sort object keys recursively for stable hashing
 */
export function sortKeys(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map((item) => sortKeys(item));

  return Object.keys(obj)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = sortKeys((obj as Record<string, unknown>)[key]);
        return acc;
      },
      {} as Record<string, unknown>
    );
}

/**
 * Generate unique event ID using deterministic identifiers
 *
 * Event ID generation strategy:
 * - Transactions: Use transaction hash (already unique)
 * - Receipts: Use receipt ID (already unique)
 * - Balance changes: SHA-256 hash of sorted raw data (collision-resistant)
 * - Token transfers: Use event_index (API-provided unique event identifier)
 */
function generateEventId(
  type: 'transactions' | 'receipts' | 'balance-changes' | 'token-transfers',
  data: NearBlocksTransaction | NearBlocksReceipt | NearBlocksActivity | NearBlocksFtTransaction
): string {
  switch (type) {
    case 'transactions':
      return (data as NearBlocksTransaction).transaction_hash;

    case 'receipts':
      return (data as NearBlocksReceipt).receipt_id;

    case 'token-transfers': {
      const ft = data as NearBlocksFtTransaction;
      // Use transaction_hash + event_index for stable, unique IDs
      const txHash = ft.transaction_hash ?? 'unknown';
      if (ft.event_index) {
        return `token-transfers:${txHash}:${ft.event_index}`;
      }
      const rawJson = JSON.stringify(sortKeys(data));
      const hash = createHash('sha256').update(rawJson).digest('hex');
      return `token-transfers:${txHash}:${hash}`;
    }

    case 'balance-changes': {
      const rawJson = JSON.stringify(sortKeys(data));
      const hash = createHash('sha256').update(rawJson).digest('hex');
      return `${type}:${hash}`;
    }
  }
}

/**
 * Normalize action type from SCREAMING_SNAKE_CASE to snake_case
 * Validates against known NEAR protocol action types
 *
 * NearBlocks API returns action types in SCREAMING_SNAKE_CASE (e.g., "TRANSFER", "FUNCTION_CALL").
 * This function normalizes to snake_case and validates against the NearActionTypeSchema enum.
 */
function normalizeActionType(rawAction: string): Result<NearActionType, Error> {
  const normalized = rawAction.toLowerCase();

  const parseResult = NearActionTypeSchema.safeParse(normalized);

  if (!parseResult.success) {
    return err(
      new Error(
        `Unknown NEAR action type: "${rawAction}". ` +
          `This action must be added to NearActionTypeSchema in schemas.ts. ` +
          `Known actions: ${NearActionTypeSchema.options.join(', ')}`
      )
    );
  }

  return ok(parseResult.data);
}

/**
 * Parse NearBlocks timestamp to Unix milliseconds (integer)
 */
function parseNearBlocksTimestamp(timestamp: string | undefined | null): number {
  if (!timestamp) return 0;

  const nanos = new Decimal(timestamp);
  const millis = nanos.dividedBy(1_000_000);
  return Math.floor(millis.toNumber());
}

/**
 * Map NearBlocks action to native NEAR action
 */
export function mapRawActionToNearAction(rawAction: NearBlocksAction): Result<NearReceiptAction, Error> {
  const actionTypeResult = normalizeActionType(rawAction.action);
  if (actionTypeResult.isErr()) {
    return err(new Error(`Failed to map action: ${actionTypeResult.error.message}`));
  }

  const action: NearReceiptAction = {
    actionType: actionTypeResult.value,
    methodName: rawAction.method ?? undefined,
    args: rawAction.args ?? undefined,
    deposit: rawAction.deposit ?? undefined,
    gas: rawAction.gas ?? undefined,
    publicKey: rawAction.public_key ?? undefined,
    beneficiaryId: rawAction.beneficiary_id ?? undefined,
    accessKey: rawAction.access_key ?? undefined,
  };

  return ok(action);
}

/**
 * Map NearBlocks receipt to native NEAR receipt
 * This is the base receipt without balance changes or token transfers
 * (those are attached during correlation)
 */
export function mapRawReceiptToNearReceipt(rawReceipt: NearBlocksReceipt): Result<NearReceipt, Error> {
  try {
    let actions: NearReceiptAction[] | undefined;
    if (rawReceipt.actions && rawReceipt.actions.length > 0) {
      const actionResults = rawReceipt.actions.map(mapRawActionToNearAction);
      const failed = actionResults.find((r) => r.isErr());
      if (failed?.isErr()) {
        return err(failed.error);
      }
      actions = actionResults.map((r) => r._unsafeUnwrap());
    }

    const blockHeight = rawReceipt.receipt_block?.block_height;
    const blockHash = rawReceipt.receipt_block?.block_hash ?? undefined;
    const blockTimestamp = parseNearBlocksTimestamp(String(rawReceipt.receipt_block.block_timestamp));

    // NearBlocks API does not return receipt_kind, so we infer it from actions presence
    // This is expected behavior and always happens
    const receiptKind = rawReceipt.actions && rawReceipt.actions.length > 0 ? 'ACTION' : 'DATA';
    logger.debug(
      { receiptId: rawReceipt.receipt_id, inferredKind: receiptKind, hasActions: !!rawReceipt.actions?.length },
      'Inferred receipt_kind from actions presence (NearBlocks API does not provide this field)'
    );

    const receipt: NearReceipt = {
      eventId: generateEventId('receipts', rawReceipt),
      id: rawReceipt.transaction_hash,
      streamType: 'receipts' as const,
      receiptId: rawReceipt.receipt_id,
      transactionHash: rawReceipt.transaction_hash,
      predecessorAccountId: rawReceipt.predecessor_account_id,
      receiverAccountId: rawReceipt.receiver_account_id,
      receiptKind,
      blockHash,
      blockHeight,
      timestamp: blockTimestamp,
      executorAccountId: rawReceipt.receipt_outcome?.executor_account_id,
      gasBurnt: rawReceipt.receipt_outcome?.gas_burnt,
      tokensBurntYocto: rawReceipt.receipt_outcome?.tokens_burnt,
      status: rawReceipt.receipt_outcome?.status,
      logs: rawReceipt.receipt_outcome?.logs ?? undefined,
      actions,
    };

    return ok(receipt);
  } catch (error) {
    return err(new Error(`Failed to map receipt: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Normalize cause from provider-specific string to internal enum
 * Returns error on unknown values to ensure API contract is maintained
 */
function normalizeCause(rawCause: string): Result<NearBalanceChangeCause, Error> {
  const upperCause = rawCause.toUpperCase();

  // Direct matches (case-insensitive)
  if (upperCause === 'TRANSFER') return ok('TRANSFER');
  if (upperCause === 'TRANSACTION') return ok('TRANSACTION');
  if (upperCause === 'RECEIPT') return ok('RECEIPT');
  if (upperCause === 'CONTRACT_REWARD') return ok('CONTRACT_REWARD');
  if (upperCause === 'MINT') return ok('MINT');
  if (upperCause === 'STAKE') return ok('STAKE');

  // Fee-related pattern matching
  if (upperCause === 'FEE') return ok('FEE');
  if (upperCause === 'GAS') return ok('GAS');
  if (upperCause === 'GAS_REFUND') return ok('GAS_REFUND');

  // Catch common variations with logging
  if (/FEE/i.test(rawCause)) {
    logger.warn({ rawCause }, 'Unknown fee variant detected, normalizing to FEE');
    return ok('FEE');
  }

  if (/GAS.*REFUND|REFUND.*GAS/i.test(rawCause)) {
    logger.warn({ rawCause }, 'Unknown gas refund variant detected, normalizing to GAS_REFUND');
    return ok('GAS_REFUND');
  }

  if (/GAS/i.test(rawCause)) {
    logger.warn({ rawCause }, 'Unknown gas variant detected, normalizing to GAS');
    return ok('GAS');
  }

  // Fail fast on unknown cause - must be added to enum
  return err(
    new Error(
      `Unknown balance change cause: "${rawCause}". ` +
        `This value must be added to NearBalanceChangeCauseSchema in schemas.ts. ` +
        `Known values: TRANSFER, TRANSACTION, RECEIPT, CONTRACT_REWARD, MINT, STAKE, FEE, GAS, GAS_REFUND`
    )
  );
}

/**
 * Map NearBlocks activity to native NEAR balance change
 * No correlation - just transforms the shape
 */
export function mapRawActivityToBalanceChange(rawActivity: NearBlocksActivity): Result<NearBalanceChange, Error> {
  const blockTimestamp = parseNearBlocksTimestamp(rawActivity.block_timestamp);

  // Use transaction_hash as id if available, otherwise fall back to receipt_id
  // This allows for child receipts that don't have a transaction_hash
  // Note: receipt_id can be null - processor will skip these during correlation
  const id =
    rawActivity.transaction_hash ??
    rawActivity.receipt_id ??
    `orphan-${rawActivity.affected_account_id}-${rawActivity.block_height}`;

  const causeResult = normalizeCause(rawActivity.cause);
  if (causeResult.isErr()) {
    return err(new Error(`Failed to map activity: ${causeResult.error.message}`));
  }

  const balanceChange: NearBalanceChange = {
    eventId: generateEventId('balance-changes', rawActivity),
    id,
    streamType: 'balance-changes' as const,
    transactionHash: rawActivity.transaction_hash ?? undefined,
    receiptId: rawActivity.receipt_id ?? undefined,
    affectedAccountId: rawActivity.affected_account_id,
    direction: rawActivity.direction,
    deltaAmountYocto: rawActivity.delta_nonstaked_amount ?? undefined,
    absoluteNonstakedAmount: rawActivity.absolute_nonstaked_amount,
    absoluteStakedAmount: rawActivity.absolute_staked_amount,
    timestamp: blockTimestamp,
    blockHeight: rawActivity.block_height,
    cause: causeResult.value,
    involvedAccountId: rawActivity.involved_account_id ?? undefined,
  };

  return ok(balanceChange);
}

/**
 * Map NearBlocks FT transaction to native NEAR token transfer
 * No correlation - just transforms the shape
 */
export function mapRawFtToTokenTransfer(rawFt: NearBlocksFtTransaction): Result<NearTokenTransfer, Error> {
  try {
    if (!rawFt.transaction_hash) {
      return err(new Error('FT transaction missing required transaction_hash'));
    }

    const blockTimestamp = parseNearBlocksTimestamp(rawFt.block_timestamp);

    const tokenTransfer: NearTokenTransfer = {
      eventId: generateEventId('token-transfers', rawFt),
      id: rawFt.transaction_hash,
      streamType: 'token-transfers' as const,
      transactionHash: rawFt.transaction_hash,
      affectedAccountId: rawFt.affected_account_id,
      contractAddress: rawFt.ft.contract,
      deltaAmountYocto: rawFt.delta_amount ?? undefined,
      decimals: rawFt.ft.decimals,
      symbol: rawFt.ft.symbol ?? undefined,
      name: rawFt.ft.name ?? undefined,
      timestamp: blockTimestamp,
      blockHeight: rawFt.block?.block_height ?? undefined,
      cause: rawFt.cause ?? undefined,
      involvedAccountId: rawFt.involved_account_id ?? undefined,
    };

    return ok(tokenTransfer);
  } catch (error) {
    return err(new Error(`Failed to map FT transfer: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Map NearBlocks transaction to normalized NEAR transaction
 * Extracts base transaction metadata from /txns-only endpoint
 */
export function mapRawTransactionToNearTransaction(rawTxn: NearBlocksTransaction): Result<NearTransaction, Error> {
  try {
    const blockTimestamp = parseNearBlocksTimestamp(rawTxn.block_timestamp);

    const transaction: NearTransaction = {
      eventId: generateEventId('transactions', rawTxn),
      id: rawTxn.transaction_hash,
      streamType: 'transactions' as const,
      transactionHash: rawTxn.transaction_hash,
      signerAccountId: rawTxn.signer_account_id,
      receiverAccountId: rawTxn.receiver_account_id,
      timestamp: blockTimestamp,
      blockHeight: rawTxn.block?.block_height,
      blockHash: rawTxn.included_in_block_hash ?? undefined,
      status: rawTxn.outcomes?.status,
    };

    return ok(transaction);
  } catch (error) {
    return err(new Error(`Failed to map transaction: ${error instanceof Error ? error.message : String(error)}`));
  }
}
