/**
 * Blockchains view TUI state
 */
import type { BlockchainViewItem } from '../blockchains-view-model.js';

/**
 * Active filters (read-only, applied from CLI args)
 */
interface BlockchainsViewFilters {
  categoryFilter?: string | undefined;
  requiresApiKeyFilter?: boolean | undefined;
}

/**
 * Blockchains view state
 */
export interface BlockchainsViewState {
  // Data
  blockchains: BlockchainViewItem[];
  categoryCounts: Record<string, number>;
  totalCount: number;
  totalProviders: number;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters
  categoryFilter?: string | undefined;
  requiresApiKeyFilter?: boolean | undefined;
}

/**
 * Compute category counts from items
 */
export function computeCategoryCounts(items: BlockchainViewItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  return counts;
}

/**
 * Create initial blockchains view state
 */
export function createBlockchainsViewState(
  blockchains: BlockchainViewItem[],
  filters: BlockchainsViewFilters,
  totalProviders: number,
  categoryCounts?: Record<string, number>,
  initialSelectedIndex?: number
): BlockchainsViewState {
  const selectedIndex = clampSelectedIndex(initialSelectedIndex, blockchains.length);

  return {
    blockchains,
    categoryCounts: categoryCounts ?? computeCategoryCounts(blockchains),
    totalCount: blockchains.length,
    totalProviders,
    selectedIndex,
    scrollOffset: selectedIndex > 0 ? selectedIndex : 0,
    categoryFilter: filters.categoryFilter,
    requiresApiKeyFilter: filters.requiresApiKeyFilter,
  };
}

function clampSelectedIndex(selectedIndex: number | undefined, itemCount: number): number {
  if (itemCount === 0) {
    return 0;
  }

  if (selectedIndex === undefined || !Number.isFinite(selectedIndex)) {
    return 0;
  }

  if (selectedIndex < 0) {
    return 0;
  }

  if (selectedIndex >= itemCount) {
    return itemCount - 1;
  }

  return selectedIndex;
}
