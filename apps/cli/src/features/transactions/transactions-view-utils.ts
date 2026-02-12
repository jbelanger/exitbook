// Utilities and types for view transactions command

import type { AssetMovement, FeeMovement, UniversalTransactionData } from '@exitbook/core';
import { computePrimaryMovement, Currency } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import { parseDate } from '../shared/view-utils.js';
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
