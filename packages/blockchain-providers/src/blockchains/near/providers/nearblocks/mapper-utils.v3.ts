/**
 * V3 Mapper utilities for converting raw NearBlocks data to normalized NEAR types
 *
 * These mappers are used by the V3 API client to convert raw provider data
 * to provider-agnostic normalized types before storage.
 *
 * Key differences from V2:
 * - Normalization happens at API client level (not processor)
 * - Maps to provider-agnostic types defined in schemas.v3.ts
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
} from '../../schemas.v3.js';
import type { NearBalanceChangeCause } from '../../schemas.v3.js';

import type {
  NearBlocksTransactionV2,
  NearBlocksReceiptV2,
  NearBlocksActionV2,
  NearBlocksActivity,
  NearBlocksFtTransaction,
} from './nearblocks.schemas.js';

const logger = getLogger('nearblocks-mapper-v3');

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
 * Generate unique event ID using deterministic hashing
 *
 * Event ID generation strategy:
 * - Transactions: Use transaction hash (already unique)
 * - Receipts: Use receipt ID (already unique)
 * - Balance changes: SHA-256 hash of sorted raw data (collision-resistant)
 * - Token transfers: SHA-256 hash of sorted raw data (collision-resistant)
 */
function generateEventId(
  type: 'transactions' | 'receipts' | 'balance-changes' | 'token-transfers',
  data: NearBlocksTransactionV2 | NearBlocksReceiptV2 | NearBlocksActivity | NearBlocksFtTransaction
): string {
  switch (type) {
    case 'transactions':
      return (data as NearBlocksTransactionV2).transaction_hash;

    case 'receipts':
      return (data as NearBlocksReceiptV2).receipt_id;

    case 'balance-changes':
    case 'token-transfers': {
      const rawJson = JSON.stringify(sortKeys(data));
      const hash = createHash('sha256').update(rawJson).digest('hex');
      return `${type}:${hash}`;
    }
  }
}

/**
 * Normalize action type to snake_case
 * Handles both PascalCase (e.g., "FunctionCall") and SCREAMING_SNAKE_CASE (e.g., "TRANSFER")
 */
function normalizeActionType(action: string): string {
  if (/^[A-Z_]+$/.test(action)) {
    return action.toLowerCase();
  }

  return action
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
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
export function mapRawActionToNearAction(rawAction: NearBlocksActionV2): Result<NearReceiptAction, Error> {
  try {
    const action: NearReceiptAction = {
      actionType: normalizeActionType(rawAction.action),
      methodName: rawAction.method ?? undefined,
      args: rawAction.args ?? undefined,
      deposit: rawAction.deposit ?? undefined,
      gas: rawAction.gas ?? undefined,
      publicKey: rawAction.public_key ?? undefined,
      beneficiaryId: rawAction.beneficiary_id ?? undefined,
      accessKey: rawAction.access_key ?? undefined,
    };

    return ok(action);
  } catch (error) {
    return err(new Error(`Failed to map action: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Map NearBlocks receipt to native NEAR receipt
 * This is the base receipt without balance changes or token transfers
 * (those are attached during correlation)
 */
export function mapRawReceiptToNearReceipt(rawReceipt: NearBlocksReceiptV2): Result<NearReceipt, Error> {
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

    if (!rawReceipt.receipt_block?.block_timestamp) {
      return err(
        new Error(
          `Receipt ${rawReceipt.receipt_id} missing block timestamp. ` +
            `This is required for event ordering and cannot be null.`
        )
      );
    }

    const blockHeight = rawReceipt.receipt_block?.block_height;
    const blockHash = rawReceipt.receipt_block?.block_hash ?? undefined;
    const blockTimestamp = parseNearBlocksTimestamp(String(rawReceipt.receipt_block.block_timestamp));

    let receiptKind: string | undefined;
    if (rawReceipt.receipt_kind) {
      receiptKind = rawReceipt.receipt_kind.toUpperCase();
    } else {
      receiptKind = rawReceipt.actions && rawReceipt.actions.length > 0 ? 'ACTION' : 'DATA';
      logger.warn(
        { receiptId: rawReceipt.receipt_id, inferredKind: receiptKind, hasActions: !!rawReceipt.actions?.length },
        'NearBlocks API missing receipt_kind, inferred from actions presence'
      );
    }

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
      blockTimestamp,
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
 * Throws error on unknown values to ensure API contract is maintained
 */
function normalizeCause(rawCause: string): NearBalanceChangeCause {
  const upperCause = rawCause.toUpperCase();

  // Direct matches (case-insensitive)
  if (upperCause === 'TRANSFER') return 'TRANSFER';
  if (upperCause === 'TRANSACTION') return 'TRANSACTION';
  if (upperCause === 'RECEIPT') return 'RECEIPT';
  if (upperCause === 'CONTRACT_REWARD') return 'CONTRACT_REWARD';
  if (upperCause === 'MINT') return 'MINT';
  if (upperCause === 'STAKE') return 'STAKE';

  // Fee-related pattern matching
  if (upperCause === 'FEE') return 'FEE';
  if (upperCause === 'GAS') return 'GAS';
  if (upperCause === 'GAS_REFUND') return 'GAS_REFUND';

  // Catch common variations with logging
  if (/FEE/i.test(rawCause)) {
    logger.warn({ rawCause }, 'Unknown fee variant detected, normalizing to FEE');
    return 'FEE';
  }

  if (/GAS.*REFUND|REFUND.*GAS/i.test(rawCause)) {
    logger.warn({ rawCause }, 'Unknown gas refund variant detected, normalizing to GAS_REFUND');
    return 'GAS_REFUND';
  }

  if (/GAS/i.test(rawCause)) {
    logger.warn({ rawCause }, 'Unknown gas variant detected, normalizing to GAS');
    return 'GAS';
  }

  // Fail fast on unknown cause - must be added to enum
  throw new Error(
    `Unknown balance change cause: "${rawCause}". ` +
      `This value must be added to NearBalanceChangeCauseSchema in schemas.v3.ts. ` +
      `Known values: TRANSFER, TRANSACTION, RECEIPT, CONTRACT_REWARD, MINT, STAKE, FEE, GAS, GAS_REFUND`
  );
}

/**
 * Map NearBlocks activity to native NEAR balance change
 * No correlation - just transforms the shape
 */
export function mapRawActivityToBalanceChange(rawActivity: NearBlocksActivity): Result<NearBalanceChange, Error> {
  try {
    const blockTimestamp = parseNearBlocksTimestamp(rawActivity.block_timestamp);

    // Use transaction_hash as id if available, otherwise fall back to receipt_id
    // This allows for child receipts that don't have a transaction_hash
    // Note: receipt_id can be null - processor will skip these during correlation
    const id =
      rawActivity.transaction_hash ??
      rawActivity.receipt_id ??
      `orphan-${rawActivity.affected_account_id}-${rawActivity.block_height}`;

    const balanceChange: NearBalanceChange = {
      eventId: generateEventId('balance-changes', rawActivity),
      id,
      streamType: 'balance-changes' as const,
      receiptId: rawActivity.receipt_id ?? undefined,
      affectedAccountId: rawActivity.affected_account_id,
      direction: rawActivity.direction,
      deltaAmountYocto: rawActivity.delta_nonstaked_amount ?? undefined,
      absoluteNonstakedAmount: rawActivity.absolute_nonstaked_amount,
      absoluteStakedAmount: rawActivity.absolute_staked_amount,
      timestamp: blockTimestamp,
      blockHeight: rawActivity.block_height,
      cause: normalizeCause(rawActivity.cause),
      involvedAccountId: rawActivity.involved_account_id ?? undefined,
    };

    return ok(balanceChange);
  } catch (error) {
    return err(new Error(`Failed to map activity: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Map NearBlocks FT transaction to native NEAR token transfer
 * No correlation - just transforms the shape
 */
export function mapRawFtToTokenTransfer(rawFt: NearBlocksFtTransaction): Result<NearTokenTransfer, Error> {
  try {
    if (!rawFt.ft?.contract) {
      return err(new Error(`FT transfer missing contract address for receipt ${rawFt.receipt_id ?? 'unknown'}`));
    }

    const blockTimestamp = parseNearBlocksTimestamp(rawFt.block_timestamp);

    // Use transaction_hash as id if available, otherwise fall back to receipt_id
    // This allows for child receipts that don't have a transaction_hash
    // Note: receipt_id can be null - processor will skip these during correlation
    const id = rawFt.transaction_hash ?? rawFt.receipt_id ?? `orphan-${rawFt.affected_account_id}-${rawFt.ft.contract}`;

    const tokenTransfer: NearTokenTransfer = {
      eventId: generateEventId('token-transfers', rawFt),
      id,
      streamType: 'token-transfers' as const,
      receiptId: rawFt.receipt_id ?? undefined,
      affectedAccountId: rawFt.affected_account_id,
      contractAddress: rawFt.ft.contract,
      deltaAmountYocto: rawFt.delta_amount ?? undefined,
      decimals: rawFt.ft.decimals,
      symbol: rawFt.ft.symbol ?? undefined,
      name: rawFt.ft.name ?? undefined,
      timestamp: blockTimestamp,
      blockHeight: rawFt.block_height ?? undefined,
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
export function mapRawTransactionToNearTransaction(rawTxn: NearBlocksTransactionV2): Result<NearTransaction, Error> {
  try {
    const blockTimestamp = parseNearBlocksTimestamp(rawTxn.block_timestamp);

    const transaction: NearTransaction = {
      eventId: generateEventId('transactions', rawTxn),
      id: rawTxn.transaction_hash,
      streamType: 'transactions' as const,
      transactionHash: rawTxn.transaction_hash,
      signerAccountId: rawTxn.signer_account_id,
      receiverAccountId: rawTxn.receiver_account_id,
      blockTimestamp,
      blockHeight: rawTxn.block?.block_height,
      blockHash: rawTxn.included_in_block_hash ?? undefined,
      status: rawTxn.outcomes?.status,
    };

    return ok(transaction);
  } catch (error) {
    return err(new Error(`Failed to map transaction: ${error instanceof Error ? error.message : String(error)}`));
  }
}
