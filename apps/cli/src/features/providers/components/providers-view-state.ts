/**
 * Providers view TUI state types and initial state factory
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'no-stats';

/**
 * Per-blockchain breakdown within a provider
 */
export interface ProviderBlockchainItem {
  name: string;
  capabilities: string[];
  rateLimit?: string | undefined;
  configSource: 'default' | 'override';

  stats?:
    | {
        avgResponseTime: number;
        errorRate: number;
        isHealthy: boolean;
        totalFailures: number;
        totalSuccesses: number;
      }
    | undefined;
}

/**
 * Aggregate stats across all blockchains for a provider
 */
export interface ProviderAggregateStats {
  totalRequests: number;
  avgResponseTime: number;
  errorRate: number;
  lastChecked: number;
}

/**
 * Per-provider display item
 */
export interface ProviderViewItem {
  name: string;
  displayName: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string | undefined;
  apiKeyConfigured?: boolean | undefined;

  blockchains: ProviderBlockchainItem[];
  chainCount: number;

  healthStatus: HealthStatus;

  stats?: ProviderAggregateStats | undefined;

  rateLimit?: string | undefined;
  configSource: 'default' | 'override';

  lastError?: string | undefined;
  lastErrorTime?: number | undefined;
}

/**
 * Active filters (read-only, applied from CLI args)
 */
export interface ProvidersViewFilters {
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
