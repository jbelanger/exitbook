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
  healthCounts?: ProvidersViewState['healthCounts'],
  initialSelectedIndex?: number
): ProvidersViewState {
  const apiKeyRequiredCount = providers.filter((p) => p.requiresApiKey).length;
  const selectedIndex = clampSelectedIndex(initialSelectedIndex, providers.length);

  return {
    providers,
    healthCounts: healthCounts ?? computeHealthCounts(providers),
    totalCount: providers.length,
    apiKeyRequiredCount,
    selectedIndex,
    scrollOffset: selectedIndex > 0 ? selectedIndex : 0,
    blockchainFilter: filters.blockchainFilter,
    healthFilter: filters.healthFilter,
    missingApiKeyFilter: filters.missingApiKeyFilter,
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
