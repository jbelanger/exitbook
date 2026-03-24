/**
 * Providers view TUI state types and initial state factory
 */
import type { ProviderViewItem } from '../providers-view-model.js';

/**
 * Active filters (read-only, applied from CLI args)
 */
interface ProvidersViewFilters {
  blockchainFilter?: string | undefined;
  healthFilter?: string | undefined;
  missingApiKeyFilter?: boolean | undefined;
}

/**
 * Providers view state
 */
export interface ProvidersViewState {
  // Data
  providers: ProviderViewItem[];
  healthCounts: {
    degraded: number;
    healthy: number;
    noStats: number;
    unhealthy: number;
  };
  totalCount: number;
  apiKeyRequiredCount: number;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Filters
  blockchainFilter?: string | undefined;
  healthFilter?: string | undefined;
  missingApiKeyFilter?: boolean | undefined;
}

/**
 * Compute health category counts from provider items
 */
export function computeHealthCounts(items: ProviderViewItem[]): ProvidersViewState['healthCounts'] {
  const counts = { healthy: 0, degraded: 0, unhealthy: 0, noStats: 0 };
  for (const item of items) {
    switch (item.healthStatus) {
      case 'healthy':
        counts.healthy++;
        break;
      case 'degraded':
        counts.degraded++;
        break;
      case 'unhealthy':
        counts.unhealthy++;
        break;
      case 'no-stats':
        counts.noStats++;
        break;
    }
  }
  return counts;
}

/**
 * Create initial providers view state
 */
export function createProvidersViewState(
  providers: ProviderViewItem[],
  filters: ProvidersViewFilters,
  healthCounts?: ProvidersViewState['healthCounts']
): ProvidersViewState {
  const apiKeyRequiredCount = providers.filter((p) => p.requiresApiKey).length;

  return {
    providers,
    healthCounts: healthCounts ?? computeHealthCounts(providers),
    totalCount: providers.length,
    apiKeyRequiredCount,
    selectedIndex: 0,
    scrollOffset: 0,
    blockchainFilter: filters.blockchainFilter,
    healthFilter: filters.healthFilter,
    missingApiKeyFilter: filters.missingApiKeyFilter,
  };
}
