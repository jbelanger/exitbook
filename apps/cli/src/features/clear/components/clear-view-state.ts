/**
 * Clear view state model and pure functions
 */

import type { DeletionPreview } from '@exitbook/ingestion';

/**
 * Phase progression: preview → confirming → executing → complete/error
 */
export type ClearPhase = 'preview' | 'confirming' | 'executing' | 'complete' | 'error';

/**
 * Scope of the clear operation
 */
export interface ClearScope {
  accountId?: number | undefined;
  source?: string | undefined;
  label: string; // "all accounts", "(kraken)", "(#4 bitcoin)"
}

/**
 * Category item for list display
 */
export interface ClearCategoryItem {
  key: string; // 'transactions', 'rawData', etc.
  label: string; // 'Transactions', 'Raw data items'
  count: number;
  group: 'processed' | 'raw';
  status: 'will-delete' | 'preserved' | 'empty';
}

/**
 * Main view state
 */
export interface ClearViewState {
  phase: ClearPhase;
  scope: ClearScope;
  previewWithRaw: DeletionPreview; // Pre-fetched
  previewWithoutRaw: DeletionPreview; // Pre-fetched
  includeRaw: boolean;
  selectedIndex: number;
  scrollOffset: number;
  result?: DeletionPreview | undefined; // Populated after execution
  error?: Error | undefined; // Populated on execution failure
}

/**
 * Get the active preview based on current includeRaw setting
 */
export function getActivePreview(state: ClearViewState): DeletionPreview {
  return state.includeRaw ? state.previewWithRaw : state.previewWithoutRaw;
}

/**
 * Calculate total items to delete (excludes preserved items)
 */
export function calculateTotalToDelete(state: ClearViewState): number {
  const preview = getActivePreview(state);
  return (
    preview.transactions +
    preview.links +
    (state.includeRaw ? preview.accounts + preview.sessions + preview.rawData : 0)
  );
}

/**
 * Build category items from current state
 */
export function buildCategoryItems(state: ClearViewState): ClearCategoryItem[] {
  const preview = getActivePreview(state);

  // Processed data categories (rows 1-2)
  const processed: ClearCategoryItem[] = [
    {
      key: 'transactions',
      label: 'Transactions',
      count: preview.transactions,
      group: 'processed',
      status: preview.transactions > 0 ? 'will-delete' : 'empty',
    },
    {
      key: 'links',
      label: 'Transaction links',
      count: preview.links,
      group: 'processed',
      status: preview.links > 0 ? 'will-delete' : 'empty',
    },
  ];

  // Raw data categories (rows 7-9)
  // Always use previewWithRaw for counts to show actual preserved data
  const rawPreview = state.previewWithRaw;
  const raw: ClearCategoryItem[] = [
    {
      key: 'accounts',
      label: 'Accounts',
      count: rawPreview.accounts,
      group: 'raw',
      status: state.includeRaw
        ? rawPreview.accounts > 0
          ? 'will-delete'
          : 'empty'
        : rawPreview.accounts > 0
          ? 'preserved'
          : 'empty',
    },
    {
      key: 'sessions',
      label: 'Import sessions',
      count: rawPreview.sessions,
      group: 'raw',
      status: state.includeRaw
        ? rawPreview.sessions > 0
          ? 'will-delete'
          : 'empty'
        : rawPreview.sessions > 0
          ? 'preserved'
          : 'empty',
    },
    {
      key: 'rawData',
      label: 'Raw data items',
      count: rawPreview.rawData,
      group: 'raw',
      status: state.includeRaw
        ? rawPreview.rawData > 0
          ? 'will-delete'
          : 'empty'
        : rawPreview.rawData > 0
          ? 'preserved'
          : 'empty',
    },
  ];

  return [...processed, ...raw];
}

/**
 * Build category items from deletion result (for complete phase)
 */
export function buildResultCategoryItems(result: DeletionPreview): ClearCategoryItem[] {
  // All items show what was deleted
  const processed: ClearCategoryItem[] = [
    {
      key: 'transactions',
      label: 'Transactions',
      count: result.transactions,
      group: 'processed',
      status: result.transactions > 0 ? 'will-delete' : 'empty',
    },
    {
      key: 'links',
      label: 'Transaction links',
      count: result.links,
      group: 'processed',
      status: result.links > 0 ? 'will-delete' : 'empty',
    },
  ];

  const raw: ClearCategoryItem[] = [
    {
      key: 'accounts',
      label: 'Accounts',
      count: result.accounts,
      group: 'raw',
      status: result.accounts > 0 ? 'will-delete' : 'empty',
    },
    {
      key: 'sessions',
      label: 'Import sessions',
      count: result.sessions,
      group: 'raw',
      status: result.sessions > 0 ? 'will-delete' : 'empty',
    },
    {
      key: 'rawData',
      label: 'Raw data items',
      count: result.rawData,
      group: 'raw',
      status: result.rawData > 0 ? 'will-delete' : 'empty',
    },
  ];

  return [...processed, ...raw];
}

/**
 * Create initial clear view state
 */
export function createClearViewState(
  scope: ClearScope,
  previewWithRaw: DeletionPreview,
  previewWithoutRaw: DeletionPreview,
  includeRaw: boolean
): ClearViewState {
  return {
    phase: 'preview',
    scope,
    previewWithRaw,
    previewWithoutRaw,
    includeRaw,
    selectedIndex: 0,
    scrollOffset: 0,
  };
}
