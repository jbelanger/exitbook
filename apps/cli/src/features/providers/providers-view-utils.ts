// Pure utility functions for providers view command
// All functions are pure — no side effects (except checkApiKeyStatus which reads process.env)

import type { ProviderInfo, ProviderStatsRow } from '@exitbook/blockchain-providers';
import type { BlockchainExplorersConfig } from '@exitbook/blockchain-providers';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { providerToSummary } from '../blockchains/blockchains-view-utils.js';
import { providerRegistry } from '../shared/provider-registry.js';

import type {
  HealthStatus,
  ProviderAggregateStats,
  ProviderBlockchainItem,
  ProviderViewItem,
} from './components/providers-view-state.js';

/**
 * Valid health filter values.
 */
const VALID_HEALTH_FILTERS = ['healthy', 'degraded', 'unhealthy'] as const;
export type HealthFilter = (typeof VALID_HEALTH_FILTERS)[number];

/**
 * Intermediate grouping: a provider's presence on a specific blockchain.
 */
export interface ProviderBlockchainEntry {
  blockchain: string;
  providerInfo: ProviderInfo;
}

/**
 * Validate the --health filter option.
 */
export function validateHealthFilter(value: string): Result<HealthFilter, Error> {
  if (!VALID_HEALTH_FILTERS.includes(value as HealthFilter)) {
    return err(new Error(`Invalid health filter: ${value}. Supported: ${VALID_HEALTH_FILTERS.join(', ')}`));
  }
  return ok(value as HealthFilter);
}

/**
 * Build a map from provider name to all blockchains it serves.
 * Iterates all blockchains and groups by provider name.
 */
export function buildProviderMap(
  allBlockchains: string[],
  getAvailable: (blockchain: string) => ProviderInfo[]
): Map<string, ProviderBlockchainEntry[]> {
  const providerMap = new Map<string, ProviderBlockchainEntry[]>();

  for (const blockchain of allBlockchains) {
    const providers = getAvailable(blockchain);
    for (const provider of providers) {
      const existing = providerMap.get(provider.name);
      const entry: ProviderBlockchainEntry = { blockchain, providerInfo: provider };
      if (existing) {
        existing.push(entry);
      } else {
        providerMap.set(provider.name, [entry]);
      }
    }
  }

  return providerMap;
}

/**
 * Shorten operation names for display (reuses logic from blockchains view).
 */
function shortenCapabilities(providerInfo: ProviderInfo): string[] {
  const summary = providerToSummary(providerInfo);
  return summary.capabilities;
}

/**
 * Get rate limit string from provider info.
 */
function getRateLimit(providerInfo: ProviderInfo): string | undefined {
  if (providerInfo.defaultConfig?.rateLimit) {
    const rl = providerInfo.defaultConfig.rateLimit;
    return `${rl.requestsPerSecond}/sec`;
  }
  return undefined;
}

/**
 * Compute aggregate stats across all blockchains for a provider.
 */
export function computeAggregateStats(
  perBlockchainStats: {
    avgResponseTime: number;
    errorRate: number;
    lastChecked: number;
    totalFailures: number;
    totalSuccesses: number;
  }[]
): ProviderAggregateStats | undefined {
  if (perBlockchainStats.length === 0) return undefined;

  const totalRequests = perBlockchainStats.reduce((sum, s) => sum + s.totalSuccesses + s.totalFailures, 0);

  if (totalRequests === 0) return undefined;

  // Weighted average response time by request count
  const weightedResponseTime = perBlockchainStats.reduce((sum, s) => {
    const requests = s.totalSuccesses + s.totalFailures;
    return sum + s.avgResponseTime * requests;
  }, 0);

  const totalFailures = perBlockchainStats.reduce((sum, s) => sum + s.totalFailures, 0);
  const lastChecked = Math.max(...perBlockchainStats.map((s) => s.lastChecked));

  return {
    totalRequests,
    avgResponseTime: Math.round(weightedResponseTime / totalRequests),
    errorRate: totalRequests > 0 ? Number(((totalFailures / totalRequests) * 100).toFixed(1)) : 0,
    lastChecked,
  };
}

/**
 * Compute overall health status from per-blockchain stats (worst-of).
 */
export function computeHealthStatus(perBlockchainStats: { errorRate: number; isHealthy: boolean }[]): HealthStatus {
  if (perBlockchainStats.length === 0) return 'no-stats';

  let worstStatus: HealthStatus = 'healthy';

  for (const stats of perBlockchainStats) {
    if (stats.errorRate >= 10) return 'unhealthy';
    if (stats.errorRate >= 2 && worstStatus === 'healthy') {
      worstStatus = 'degraded';
    }
  }

  return worstStatus;
}

/**
 * Check if an API key environment variable is set.
 */
export function checkApiKeyStatus(envVar: string | undefined): boolean | undefined {
  if (!envVar) return undefined;
  return !!process.env[envVar];
}

/**
 * Detect whether a provider's config comes from defaults or an override file for a specific blockchain.
 */
export function detectConfigSourceForBlockchain(
  providerName: string,
  blockchain: string,
  explorerConfig: BlockchainExplorersConfig | undefined
): 'default' | 'override' {
  if (!explorerConfig) return 'default';

  const blockchainConfig = explorerConfig[blockchain];
  if (blockchainConfig?.overrides?.[providerName]) {
    return 'override';
  }

  return 'default';
}

/**
 * Detect whether a provider has ANY overrides across all its blockchains (provider-level summary).
 */
export function detectConfigSource(
  providerName: string,
  blockchains: string[],
  explorerConfig: BlockchainExplorersConfig | undefined
): 'default' | 'override' {
  if (!explorerConfig) return 'default';

  for (const blockchain of blockchains) {
    const blockchainConfig = explorerConfig[blockchain];
    if (blockchainConfig?.overrides?.[providerName]) {
      return 'override';
    }
  }

  return 'default';
}

/**
 * Find the worst (most recent) error across all blockchain stats for a provider.
 */
function findLastError(statsRows: ProviderStatsRow[]): { lastError: string; lastErrorTime: number } | undefined {
  let worstError: { lastError: string; lastErrorTime: number } | undefined;

  for (const row of statsRows) {
    if (row.last_error && row.last_failure_time > 0) {
      if (!worstError || row.last_failure_time > worstError.lastErrorTime) {
        worstError = { lastError: row.last_error, lastErrorTime: row.last_failure_time };
      }
    }
  }

  return worstError;
}

/**
 * Merge registry metadata, stats, and config into ProviderViewItem[].
 */
export function mergeProviderData(
  providerMap: Map<string, ProviderBlockchainEntry[]>,
  allStatsRows: ProviderStatsRow[],
  explorerConfig: BlockchainExplorersConfig | undefined
): ProviderViewItem[] {
  // Index stats by "blockchain:provider_name"
  const statsIndex = new Map<string, ProviderStatsRow>();
  for (const row of allStatsRows) {
    statsIndex.set(`${row.blockchain}:${row.provider_name}`, row);
  }

  const items: ProviderViewItem[] = [];

  for (const [providerName, entries] of providerMap) {
    // Use first entry for provider-level metadata
    const firstEntry = entries[0]!;
    const providerInfo = firstEntry.providerInfo;

    // Get API key env var from metadata
    let apiKeyEnvVar: string | undefined;
    if (providerInfo.requiresApiKey) {
      // Check metadata from any blockchain — env var is provider-level
      for (const entry of entries) {
        const metadata = providerRegistry.getMetadata(entry.blockchain, providerName);
        if (metadata?.apiKeyEnvVar) {
          apiKeyEnvVar = metadata.apiKeyEnvVar;
          break;
        }
      }
    }

    // Build per-blockchain items
    const blockchainNames = entries.map((e) => e.blockchain);
    const blockchainItems: ProviderBlockchainItem[] = entries.map((entry) => {
      const capabilities = shortenCapabilities(entry.providerInfo);
      const rateLimit = getRateLimit(entry.providerInfo);
      const statsRow = statsIndex.get(`${entry.blockchain}:${providerName}`);
      const configSource = detectConfigSourceForBlockchain(providerName, entry.blockchain, explorerConfig);

      const item: ProviderBlockchainItem = {
        name: entry.blockchain,
        capabilities,
        rateLimit,
        configSource,
      };

      if (statsRow && (statsRow.total_successes > 0 || statsRow.total_failures > 0)) {
        const totalReqs = statsRow.total_successes + statsRow.total_failures;
        item.stats = {
          totalSuccesses: statsRow.total_successes,
          totalFailures: statsRow.total_failures,
          avgResponseTime: Math.round(statsRow.avg_response_time),
          errorRate: totalReqs > 0 ? Number(((statsRow.total_failures / totalReqs) * 100).toFixed(1)) : 0,
          isHealthy: statsRow.is_healthy === 1,
        };
      }

      return item;
    });

    // Collect stats for aggregate computation
    const providerStatsRows = entries
      .map((e) => statsIndex.get(`${e.blockchain}:${providerName}`))
      .filter((row): row is ProviderStatsRow => row !== undefined);

    const perChainStatsForAggregate = providerStatsRows
      .filter((row) => row.total_successes > 0 || row.total_failures > 0)
      .map((row) => ({
        avgResponseTime: row.avg_response_time,
        totalSuccesses: row.total_successes,
        totalFailures: row.total_failures,
        errorRate:
          row.total_successes + row.total_failures > 0
            ? (row.total_failures / (row.total_successes + row.total_failures)) * 100
            : 0,
        lastChecked: row.last_checked,
        isHealthy: row.is_healthy === 1,
      }));

    const aggregateStats = computeAggregateStats(perChainStatsForAggregate);
    const healthStatus = computeHealthStatus(perChainStatsForAggregate);

    const apiKeyConfigured = checkApiKeyStatus(apiKeyEnvVar);
    const configSource = detectConfigSource(providerName, blockchainNames, explorerConfig);
    const rateLimit = getRateLimit(providerInfo);
    const errorInfo = findLastError(providerStatsRows);

    const viewItem: ProviderViewItem = {
      name: providerName,
      displayName: providerInfo.displayName,
      requiresApiKey: providerInfo.requiresApiKey,
      apiKeyEnvVar,
      apiKeyConfigured,
      blockchains: blockchainItems,
      chainCount: entries.length,
      healthStatus,
      stats: aggregateStats,
      rateLimit,
      configSource,
      lastError: errorInfo?.lastError,
      lastErrorTime: errorInfo?.lastErrorTime,
    };

    items.push(viewItem);
  }

  return items;
}

/**
 * Filter providers by blockchain name.
 */
function filterByBlockchain(items: ProviderViewItem[], blockchain: string): ProviderViewItem[] {
  return items.filter((item) => item.blockchains.some((b) => b.name === blockchain));
}

/**
 * Filter providers by health status.
 * Note: 'degraded' filter includes both degraded AND unhealthy (worst-of logic).
 */
function filterByHealth(items: ProviderViewItem[], health: HealthFilter): ProviderViewItem[] {
  if (health === 'degraded') {
    return items.filter((item) => item.healthStatus === 'degraded' || item.healthStatus === 'unhealthy');
  }
  return items.filter((item) => item.healthStatus === health);
}

/**
 * Filter providers by missing API key.
 */
function filterByMissingApiKey(items: ProviderViewItem[]): ProviderViewItem[] {
  return items.filter((item) => item.requiresApiKey && item.apiKeyConfigured === false);
}

/**
 * Apply all filters.
 */
export function filterProviders(
  items: ProviderViewItem[],
  filters: {
    blockchain?: string | undefined;
    health?: HealthFilter | undefined;
    missingApiKey?: boolean | undefined;
  }
): ProviderViewItem[] {
  let result = items;

  if (filters.blockchain) {
    result = filterByBlockchain(result, filters.blockchain);
  }

  if (filters.health) {
    result = filterByHealth(result, filters.health);
  }

  if (filters.missingApiKey) {
    result = filterByMissingApiKey(result);
  }

  return result;
}

/**
 * Sort providers by total requests descending, no-stats to bottom, then alphabetical.
 */
export function sortProviders(items: ProviderViewItem[]): ProviderViewItem[] {
  return [...items].sort((a, b) => {
    const aHasStats = a.stats !== undefined;
    const bHasStats = b.stats !== undefined;

    // Providers with stats come first
    if (aHasStats && !bHasStats) return -1;
    if (!aHasStats && bHasStats) return 1;

    // Both have stats: sort by total requests descending
    if (aHasStats && bHasStats) {
      const diff = b.stats!.totalRequests - a.stats!.totalRequests;
      if (diff !== 0) return diff;
    }

    // Alphabetical fallback
    return a.name.localeCompare(b.name);
  });
}

/**
 * Format an epoch ms timestamp to a relative time string.
 */
export function formatTimeAgo(epochMs: number): string {
  const now = Date.now();
  const diffMs = now - epochMs;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
