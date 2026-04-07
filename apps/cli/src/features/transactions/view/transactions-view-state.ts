/**
 * Transactions view TUI state
 */

import type { OperationCategory } from '@exitbook/core';

import type { ExportFormat } from '../transactions-export-model.js';
import type { CategoryCounts, TransactionViewItem, TransactionsViewFilters } from '../transactions-view-model.js';

/**
 * TUI phase: controls which panel is shown and which keys are active.
 */
export type TransactionsViewPhase = 'browse' | 'export-format' | 'exporting' | 'export-complete' | 'export-error';

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
  categoryCounts?: CategoryCounts,
  initialSelectedIndex?: number
): TransactionsViewState {
  const safeSelectedIndex =
    transactions.length === 0
      ? 0
      : Math.min(Math.max(initialSelectedIndex ?? 0, 0), Math.max(transactions.length - 1, 0));

  return {
    transactions,
    categoryCounts: categoryCounts ?? computeCategoryCounts(transactions),
    totalCount,
    selectedIndex: safeSelectedIndex,
    scrollOffset: 0,
    filters,
    displayedCount: transactions.length < totalCount ? transactions.length : undefined,
    phase: 'browse',
    exportPanel: undefined,
  };
}
