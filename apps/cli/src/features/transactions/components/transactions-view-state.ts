/**
 * Transactions view TUI state
 */

import type { OperationCategory } from '@exitbook/core';
import type { Result } from 'neverthrow';

import type { CsvFormat, ExportFormat } from '../../export/export-utils.js';

/**
 * Per-movement display item (inflow or outflow)
 */
export interface MovementDisplayItem {
  assetSymbol: string;
  amount: string;
  priceAtTxTime?: { price: string; source: string } | undefined;
}

/**
 * Per-fee display item
 */
export interface FeeDisplayItem {
  assetSymbol: string;
  amount: string;
  scope: string;
  settlement: string;
  priceAtTxTime?: { price: string; source: string } | undefined;
}

/**
 * Per-transaction display item
 */
export interface TransactionViewItem {
  // Identity
  id: number;
  source: string;
  sourceType: 'exchange' | 'blockchain';
  externalId: string | undefined;
  datetime: string;

  // Operation
  operationCategory: string;
  operationType: string;

  // Primary movement (for list row)
  primaryAsset: string | undefined;
  primaryAmount: string | undefined;
  primaryDirection: 'in' | 'out' | undefined;

  // All movements (for detail panel)
  inflows: MovementDisplayItem[];
  outflows: MovementDisplayItem[];
  fees: FeeDisplayItem[];

  // Price status
  priceStatus: 'all' | 'partial' | 'none' | 'not-needed';

  // Blockchain metadata
  blockchain:
    | {
        blockHeight?: number | undefined;
        isConfirmed: boolean;
        name: string;
        transactionHash: string;
      }
    | undefined;

  // Addresses
  from: string | undefined;
  to: string | undefined;

  // Notes
  notes: { message: string; severity?: string | undefined; type: string }[];

  // Flags
  excludedFromAccounting: boolean;
  isSpam: boolean;
}

/**
 * Category counts for header
 */
export interface CategoryCounts {
  trade: number;
  transfer: number;
  staking: number;
  other: number;
}

/**
 * Active filters (read-only, applied from CLI args)
 */
export interface TransactionsViewFilters {
  sourceFilter?: string | undefined;
  assetFilter?: string | undefined;
  operationTypeFilter?: string | undefined;
  noPriceFilter?: boolean | undefined;
}

/**
 * TUI phase: controls which panel is shown and which keys are active.
 */
export type TransactionsViewPhase = 'browse' | 'export-format' | 'exporting' | 'export-complete' | 'export-error';

/**
 * Export callback result returned from the entry-point onExport callback.
 */
export interface ExportCallbackResult {
  outputPaths: string[];
  transactionCount: number;
}

/**
 * Callback signature passed from the entry point into the component.
 */
export type OnExport = (
  format: ExportFormat,
  csvFormat: CsvFormat | undefined
) => Promise<Result<ExportCallbackResult, Error>>;

/**
 * Export panel state (discriminated by phase).
 */
export type ExportPanelState =
  | { phase: 'export-format'; selectedFormatIndex: number }
  | { format: ExportFormat; phase: 'exporting'; transactionCount: number }
  | { outputPaths: string[]; phase: 'export-complete'; transactionCount: number }
  | { message: string; phase: 'export-error' };

/**
 * Transactions view state
 */
export interface TransactionsViewState {
  // Data
  transactions: TransactionViewItem[];
  categoryCounts: CategoryCounts;
  totalCount: number;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters
  filters: TransactionsViewFilters;

  // When limit truncates results
  displayedCount?: number | undefined;

  // Export
  phase: TransactionsViewPhase;
  exportPanel?: ExportPanelState | undefined;
}

/**
 * Map an operation category to its display group
 */
function categoryGroup(category: string): keyof CategoryCounts {
  switch (category as OperationCategory) {
    case 'trade':
      return 'trade';
    case 'transfer':
      return 'transfer';
    case 'staking':
      return 'staking';
    default:
      return 'other';
  }
}

/**
 * Compute category counts from items
 */
export function computeCategoryCounts(items: TransactionViewItem[]): CategoryCounts {
  const counts: CategoryCounts = { trade: 0, transfer: 0, staking: 0, other: 0 };
  for (const item of items) {
    counts[categoryGroup(item.operationCategory)] += 1;
  }
  return counts;
}

/**
 * Create initial transactions view state
 */
export function createTransactionsViewState(
  transactions: TransactionViewItem[],
  filters: TransactionsViewFilters,
  totalCount: number,
  categoryCounts?: CategoryCounts
): TransactionsViewState {
  return {
    transactions,
    categoryCounts: categoryCounts ?? computeCategoryCounts(transactions),
    totalCount,
    selectedIndex: 0,
    scrollOffset: 0,
    filters,
    displayedCount: transactions.length < totalCount ? transactions.length : undefined,
    phase: 'browse',
    exportPanel: undefined,
  };
}
