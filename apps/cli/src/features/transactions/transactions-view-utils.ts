// Utilities and types for view transactions command

import type { AssetMovement, FeeMovement, SourceType, UniversalTransactionData } from '@exitbook/core';
import { computePrimaryMovement, Currency } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { formatDateTime, parseDate } from '../shared/view-utils.js';
import type { CommonViewFilters } from '../shared/view-utils.js';

import type {
  FeeDisplayItem,
  MovementDisplayItem,
  TransactionViewItem,
  TransactionsViewFilters,
} from './components/transactions-view-state.js';
import type { ExportFormat } from './transactions-export-utils.js';

/**
 * Parameters for view transactions command.
 */
export interface ViewTransactionsParams extends CommonViewFilters {
  assetSymbol?: string | undefined;
  operationType?: string | undefined;
  noPrice?: boolean | undefined;
}

/**
 * Transaction info for display.
 */
export interface TransactionInfo {
  id: number;
  source_name: string;
  source_type: SourceType;
  external_id: string | null | undefined;
  transaction_datetime: string;
  operation_category: string | null | undefined;
  operation_type: string | null | undefined;
  movements_primary_asset: string | null | undefined;
  movements_primary_amount: string | null | undefined;
  movements_primary_direction: string | null | undefined;
  from_address: string | null | undefined;
  to_address: string | null | undefined;
  blockchain_transaction_hash: string | null | undefined;
}

/**
 * Type alias for formatted transaction (same as TransactionInfo).
 */
export type FormattedTransaction = TransactionInfo;

/**
 * Result of view transactions command.
 */
export interface ViewTransactionsResult {
  transactions: TransactionInfo[];
  count: number;
}

/**
 * Get direction icon for transaction movement.
 */
export function getDirectionIcon(direction: string | null | undefined): string {
  switch (direction) {
    case 'in':
      return '←';
    case 'out':
      return '→';
    default:
      return '↔';
  }
}

/**
 * Format operation label from category and type.
 */
export function formatOperationLabel(category: string | null | undefined, type: string | null | undefined): string {
  if (category && type) {
    return `${category}/${type}`;
  }
  return 'Unknown';
}

/**
 * Apply filters to transactions based on provided parameters.
 */
export function applyTransactionFilters(
  transactions: UniversalTransactionData[],
  params: ViewTransactionsParams
): Result<UniversalTransactionData[], Error> {
  let filtered = transactions;

  // Filter by until date
  if (params.until) {
    const untilDateResult = parseDate(params.until);
    if (untilDateResult.isErr()) {
      return err(untilDateResult.error);
    }
    const untilDate = untilDateResult.value;
    filtered = filtered.filter((tx) => new Date(tx.datetime) <= untilDate);
  }

  // Filter by asset
  if (params.assetSymbol) {
    filtered = filtered.filter((tx) => {
      const hasInflow = tx.movements.inflows?.some((m) => m.assetSymbol === params.assetSymbol);
      const hasOutflow = tx.movements.outflows?.some((m) => m.assetSymbol === params.assetSymbol);
      return hasInflow || hasOutflow;
    });
  }

  // Filter by operation type
  if (params.operationType) {
    filtered = filtered.filter((tx) => tx.operation.type === params.operationType);
  }

  // Filter by missing price data
  if (params.noPrice) {
    filtered = filtered.filter((tx) => {
      const status = computePriceStatus(tx);
      return status === 'none' || status === 'partial';
    });
  }

  return ok(filtered);
}

/**
 * Format a UniversalTransactionData for display.
 */
export function formatTransactionForDisplay(tx: UniversalTransactionData): FormattedTransaction {
  const primary = computePrimaryMovement(tx.movements.inflows, tx.movements.outflows);

  return {
    id: tx.id,

    external_id: tx.externalId,
    source_name: tx.source,
    source_type: tx.blockchain ? ('blockchain' as const) : ('exchange' as const),
    transaction_datetime: tx.datetime,
    operation_category: tx.operation.category,
    operation_type: tx.operation.type,
    movements_primary_asset: primary?.assetSymbol ?? undefined,
    movements_primary_amount: primary?.amount.toFixed() ?? undefined,
    movements_primary_direction: primary?.direction ?? undefined,
    from_address: tx.from,
    to_address: tx.to,
    blockchain_transaction_hash: tx.blockchain?.transaction_hash,
  };
}

/**
 * Render a TransactionInfo as a text string.
 */
export function renderTransactionInfo(tx: TransactionInfo): string {
  const lines: string[] = [];
  const operationLabel = formatOperationLabel(tx.operation_category, tx.operation_type);
  const dateStr = formatDateTime(new Date(tx.transaction_datetime));

  lines.push(`Transaction #${tx.id}`);
  lines.push(`   Source: ${tx.source_name} (${tx.source_type})`);
  lines.push(`   Date: ${dateStr}`);
  lines.push(`   Operation: ${operationLabel}`);

  if (tx.movements_primary_asset) {
    const directionIcon = getDirectionIcon(tx.movements_primary_direction);
    const amount = tx.movements_primary_amount ?? '?';
    lines.push(`   Movement: ${directionIcon} ${amount} ${tx.movements_primary_asset}`);
  }

  if (tx.blockchain_transaction_hash) {
    lines.push(`   Hash: ${tx.blockchain_transaction_hash}`);
  }

  if (tx.from_address || tx.to_address) {
    if (tx.from_address) lines.push(`   From: ${tx.from_address}`);
    if (tx.to_address) lines.push(`   To: ${tx.to_address}`);
  }

  return lines.join('\n');
}

/**
 * Format transactions list for text display.
 */
export function formatTransactionsListForDisplay(transactions: TransactionInfo[], count: number): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Transactions:');
  lines.push('=============================');
  lines.push('');

  if (transactions.length === 0) {
    lines.push('No transactions found.');
  } else {
    for (const tx of transactions) {
      lines.push(renderTransactionInfo(tx));
      lines.push('');
    }
  }

  lines.push('=============================');
  lines.push(`Total: ${count} transactions`);

  return lines.join('\n');
}

// ─── TUI Transformation Utilities ───────────────────────────────────────────

/**
 * Check if an asset is fiat (no pricing needed).
 */
function isFiatAsset(assetSymbol: string): boolean {
  return Currency.create(assetSymbol).isFiat();
}

/**
 * Convert an AssetMovement to a MovementDisplayItem.
 */
function toMovementDisplayItem(m: AssetMovement): MovementDisplayItem {
  return {
    assetSymbol: m.assetSymbol,
    amount: m.grossAmount.toFixed(),
    priceAtTxTime: m.priceAtTxTime
      ? { price: `$${m.priceAtTxTime.price.amount.toFixed(2)}`, source: m.priceAtTxTime.source }
      : undefined,
  };
}

/**
 * Convert a FeeMovement to a FeeDisplayItem.
 */
function toFeeDisplayItem(f: FeeMovement): FeeDisplayItem {
  return {
    assetSymbol: f.assetSymbol,
    amount: f.amount.toFixed(),
    scope: f.scope,
    settlement: f.settlement,
    priceAtTxTime: f.priceAtTxTime
      ? { price: `$${f.priceAtTxTime.price.amount.toFixed(2)}`, source: f.priceAtTxTime.source }
      : undefined,
  };
}

/**
 * Compute the price status for a transaction.
 *
 * - `all`: every non-fiat movement has priceAtTxTime
 * - `partial`: some have it, some don't
 * - `none`: no non-fiat movement has priceAtTxTime
 * - `not-needed`: all movements are fiat
 */
export function computePriceStatus(tx: UniversalTransactionData): 'all' | 'partial' | 'none' | 'not-needed' {
  const allMovements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? [])];

  // Filter to non-fiat movements only (fiat doesn't need pricing)
  const nonFiat = allMovements.filter((m) => !isFiatAsset(m.assetSymbol));

  if (nonFiat.length === 0) {
    return 'not-needed';
  }

  const priced = nonFiat.filter((m) => m.priceAtTxTime !== undefined);

  if (priced.length === nonFiat.length) return 'all';
  if (priced.length === 0) return 'none';
  return 'partial';
}

/**
 * Transform a UniversalTransactionData into a TransactionViewItem for TUI display.
 */
export function toTransactionViewItem(tx: UniversalTransactionData): TransactionViewItem {
  const primary = computePrimaryMovement(tx.movements.inflows, tx.movements.outflows);

  const inflows = (tx.movements.inflows ?? []).map(toMovementDisplayItem);
  const outflows = (tx.movements.outflows ?? []).map(toMovementDisplayItem);
  const fees = (tx.fees ?? []).map(toFeeDisplayItem);

  return {
    id: tx.id,
    source: tx.source,
    sourceType: tx.blockchain ? 'blockchain' : 'exchange',
    externalId: tx.externalId ?? undefined,
    datetime: tx.datetime,

    operationCategory: tx.operation.category,
    operationType: tx.operation.type,

    primaryAsset: primary?.assetSymbol ?? undefined,
    primaryAmount: primary?.amount.toFixed() ?? undefined,
    primaryDirection: primary?.direction === 'neutral' ? undefined : (primary?.direction ?? undefined),

    inflows,
    outflows,
    fees,

    priceStatus: computePriceStatus(tx),

    blockchain: tx.blockchain
      ? {
          name: tx.blockchain.name,
          blockHeight: tx.blockchain.block_height,
          transactionHash: tx.blockchain.transaction_hash,
          isConfirmed: tx.blockchain.is_confirmed,
        }
      : undefined,

    from: tx.from ?? undefined,
    to: tx.to ?? undefined,

    notes: (tx.notes ?? []).map((n) => ({
      type: n.type,
      message: n.message,
      severity: n.severity,
    })),

    excludedFromAccounting: tx.excludedFromAccounting ?? false,
    isSpam: tx.isSpam ?? false,
  };
}

/**
 * Generate a default output path for inline export based on active filters and format.
 */
export function generateDefaultPath(filters: TransactionsViewFilters, format: ExportFormat): string {
  const parts: string[] = [];
  if (filters.sourceFilter) parts.push(filters.sourceFilter);
  if (filters.assetFilter) parts.push(filters.assetFilter.toLowerCase());
  parts.push('transactions');
  const extension = format === 'json' ? '.json' : '.csv';
  return `data/${parts.join('-')}${extension}`;
}
