/**
 * Blockchains view TUI state
 */

/**
 * Per-provider display item
 */
export interface ProviderViewItem {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string | undefined;
  apiKeyConfigured?: boolean | undefined;
  capabilities: string[];
  rateLimit?: string | undefined;
}

/**
 * Per-blockchain display item
 */
export interface BlockchainViewItem {
  name: string;
  displayName: string;
  category: string;
  layer?: string | undefined;

  providers: ProviderViewItem[];
  providerCount: number;

  keyStatus: 'all-configured' | 'some-missing' | 'none-needed';
  missingKeyCount: number;

  exampleAddress: string;
}

/**
 * Active filters (read-only, applied from CLI args)
 */
export interface BlockchainsViewFilters {
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
  categoryCounts?: Record<string, number>
): BlockchainsViewState {
  return {
    blockchains,
    categoryCounts: categoryCounts ?? computeCategoryCounts(blockchains),
    totalCount: blockchains.length,
    totalProviders,
    selectedIndex: 0,
    scrollOffset: 0,
    categoryFilter: filters.categoryFilter,
    requiresApiKeyFilter: filters.requiresApiKeyFilter,
  };
}
