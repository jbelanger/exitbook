/**
 * Utility functions for blockchain provider management
 *
 * Most functions are pure (no side effects), but deduplication helpers
 * mutate state in place for performance in hot paths.
 */

import type { CursorState, CursorType, PaginationCursor } from '@exitbook/core';
import { isCircuitHalfOpen, isCircuitOpen, type CircuitState } from '@exitbook/resilience/circuit-breaker';

import type { NormalizedTransactionBase } from '../index.js';
import type {
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderHealth,
  ProviderOperation,
  ProviderOperationType,
} from '../types/index.js';
import type { ProviderMetadata } from '../types/registry.js';

// Re-export shared provider health utilities so existing consumers keep working
export {
  createInitialHealth,
  getProviderHealthWithCircuit,
  hasAvailableProviders,
  shouldBlockDueToCircuit,
  updateHealthMetrics,
} from '@exitbook/resilience/provider-health';

// Deduplication window size: Used for in-memory dedup during streaming and loading recent transaction IDs
// Sized to cover typical replay overlap (5 blocks × ~200 txs/block = ~1000 items max)
export const DEFAULT_DEDUP_WINDOW_SIZE = 1000;

/**
 * Check if cache entry is still valid
 */
export function isCacheValid(expiry: number, now: number): boolean {
  return expiry > now;
}

/**
 * Score a provider based on health, performance, and rate limits
 * Pure function - takes all context as parameters
 */
export function scoreProvider(
  provider: IBlockchainProvider,
  health: ProviderHealth,
  circuitState: CircuitState,
  now: number
): number {
  let score = 100; // Base score

  // Health penalties
  if (!health.isHealthy) score -= 50;
  if (isCircuitOpen(circuitState, now)) score -= 100; // Severe penalty for open circuit
  if (isCircuitHalfOpen(circuitState, now)) score -= 25; // Moderate penalty for half-open

  // Rate limit penalties - both configured limits and actual rate limiting events
  const rateLimit = provider.rateLimit.requestsPerSecond;
  if (rateLimit <= 0.5)
    score -= 40; // Very restrictive (like mempool.space 0.25/sec)
  else if (rateLimit <= 1.0)
    score -= 20; // Moderately restrictive
  else if (rateLimit >= 3.0) score += 10; // Generous rate limits get bonus

  // Performance bonuses/penalties
  if (health.averageResponseTime < 1000) score += 20; // Fast response bonus
  if (health.averageResponseTime > 5000) score -= 30; // Slow response penalty

  // Error rate penalties
  score -= health.errorRate * 50; // Up to 50 point penalty for 100% error rate

  // Consecutive failure penalties
  score -= health.consecutiveFailures * 10;

  return Math.max(0, score); // Never go below 0
}

/**
 * Check if provider supports the requested operation
 */
export function supportsOperation(capabilities: ProviderCapabilities, operation: ProviderOperation): boolean {
  if (!capabilities.supportedOperations.includes(operation.type as ProviderOperationType)) {
    return false;
  }

  // For getAddressTransactions, check supportedTransactionTypes (defaults to 'normal')
  if (operation.type === 'getAddressTransactions') {
    const streamType = operation.streamType || 'normal';
    if (!capabilities.supportedTransactionTypes) {
      // If provider doesn't declare supported types, assume it only supports 'normal'
      return streamType === 'normal';
    }
    return capabilities.supportedTransactionTypes.includes(streamType);
  }

  return true;
}

/**
 * Select and order providers based on scores and capabilities
 * Pure function - no side effects, deterministic ordering
 */
export function selectProvidersForOperation(
  providers: IBlockchainProvider[],
  healthMap: Map<string, ProviderHealth>,
  circuitMap: Map<string, CircuitState>,
  operation: ProviderOperation,
  now: number
): {
  health: ProviderHealth;
  provider: IBlockchainProvider;
  score: number;
}[] {
  return providers
    .filter((p) => supportsOperation(p.capabilities, operation))
    .map((provider) => {
      const health = healthMap.get(provider.name);
      const circuitState = circuitMap.get(provider.name);

      // Skip if missing health or circuit state
      if (!health || !circuitState) {
        return;
      }

      return {
        health,
        provider,
        score: scoreProvider(provider, health, circuitState, now),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .sort((a, b) => b.score - a.score); // Higher score = better
}

/**
 * Build debug info for provider selection
 */
export function buildProviderSelectionDebugInfo(
  scoredProviders: {
    health: ProviderHealth;
    provider: IBlockchainProvider;
    score: number;
  }[]
): string {
  const providerInfo = scoredProviders.map((item) => ({
    avgResponseTime: Math.round(item.health.averageResponseTime),
    consecutiveFailures: item.health.consecutiveFailures,
    errorRate: Math.round(item.health.errorRate * 100),
    isHealthy: item.health.isHealthy,
    name: item.provider.name,
    rateLimitPerSec: item.provider.rateLimit.requestsPerSecond,
    score: item.score,
  }));

  return JSON.stringify(providerInfo);
}

/**
 * Check if provider can resume from cursor
 */
export function canProviderResume(provider: IBlockchainProvider, cursor: CursorState): boolean {
  const supportedTypes = provider.capabilities.supportedCursorTypes;

  // If provider doesn't declare cursor support, assume it can't resume
  if (!supportedTypes || supportedTypes.length === 0) {
    return false;
  }

  // Check primary cursor
  if (supportedTypes.includes(cursor.primary.type)) {
    // If it's a pageToken, must match provider name
    if (cursor.primary.type === 'pageToken') {
      return cursor.primary.providerName === provider.name;
    }
    return true;
  }

  // Check alternatives
  return (
    cursor.alternatives?.some(
      (alt) => supportedTypes.includes(alt.type) && (alt.type !== 'pageToken' || alt.providerName === provider.name)
    ) || false
  );
}

/**
 * Deduplication window management
 */
export interface DeduplicationWindow {
  queue: string[];
  set: Set<string>;
}

/**
 * Create initial deduplication window
 */
export function createDeduplicationWindow(initialIds: string[] = []): DeduplicationWindow {
  return {
    queue: [...initialIds],
    set: new Set(initialIds),
  };
}

/**
 * Add ID to deduplication window, evicting oldest if necessary
 * Mutates the window in place for performance (avoids O(n) array/set copies)
 */
export function addToDeduplicationWindow(window: DeduplicationWindow, id: string, maxSize: number): void {
  window.queue.push(id);
  window.set.add(id);

  // Evict oldest if over limit
  if (window.queue.length > maxSize) {
    const oldest = window.queue.shift()!;
    window.set.delete(oldest);
  }
}

/**
 * Check if ID is in deduplication window
 */
export function isInDeduplicationWindow(window: DeduplicationWindow, id: string): boolean {
  return window.set.has(id);
}

/**
 * Filter transactions by deduplication
 * Mutates the window in place for performance
 */
export function deduplicateTransactions<T extends { normalized: NormalizedTransactionBase }>(
  transactions: T[],
  window: DeduplicationWindow,
  maxWindowSize: number
): T[] {
  const deduplicated: T[] = [];

  for (const tx of transactions) {
    // Use eventId computed by provider during normalization
    const key = tx.normalized.eventId;

    if (isInDeduplicationWindow(window, key)) {
      // Skip duplicate
      continue;
    }

    // Add to results and update window
    deduplicated.push(tx);
    addToDeduplicationWindow(window, key, maxWindowSize);
  }

  return deduplicated;
}

/**
 * Configuration for cursor resolution
 */
export interface CursorResolutionConfig {
  /**
   * Provider name (for matching pageToken cursors)
   */
  providerName: string;

  /**
   * Cursor types this provider supports for resumption
   */
  supportedCursorTypes: CursorType[];

  /**
   * Whether this is a cross-provider failover (vs same-provider resume)
   * Replay window is only applied during failover to prevent gaps
   */
  isFailover: boolean;

  /**
   * Function to apply replay window to cross-provider cursors
   */
  applyReplayWindow: (cursor: PaginationCursor) => PaginationCursor;
}

/**
 * Result of cursor resolution
 */
export interface ResolvedCursor {
  /**
   * Page token for provider-specific pagination (most efficient)
   */
  pageToken?: string | undefined;

  /**
   * Block number for cross-provider resumption
   */
  fromBlock?: number | undefined;

  /**
   * Timestamp for cross-provider resumption
   */
  fromTimestamp?: number | undefined;
}

/**
 * Resolve cursor for resumption with cross-provider failover support
 *
 * Priority order:
 * 1. Use pageToken from same provider (most efficient)
 * 2. Use blockNumber/timestamp cursor from alternatives (cross-provider failover)
 * 3. Start from beginning if no compatible cursor found
 *
 * Applies replay window when using cursors from different providers to prevent gaps.
 *
 * @param resumeCursor - Cursor state to resume from (undefined = start from beginning)
 * @param config - Provider configuration for cursor resolution
 * @param logger - Logger for diagnostic messages
 * @returns Resolved cursor parameters for API call
 */
export function resolveCursorForResumption(
  resumeCursor: CursorState | undefined,
  config: CursorResolutionConfig,
  logger: { info: (msg: string) => void; warn: (msg: string) => void }
): ResolvedCursor {
  const resolved: ResolvedCursor = {};

  if (!resumeCursor) {
    return resolved;
  }

  // Priority 1: Use pageToken from same provider (most efficient)
  if (resumeCursor.primary.type === 'pageToken' && resumeCursor.primary.providerName === config.providerName) {
    resolved.pageToken = resumeCursor.primary.value;
    logger.info(`Resuming from ${config.providerName} pageToken: ${resolved.pageToken}`);
    return resolved;
  }

  // Priority 2: Use blockNumber/timestamp cursor (cross-provider failover or same-provider resume)
  const blockCursor =
    resumeCursor.primary.type === 'blockNumber'
      ? resumeCursor.primary
      : resumeCursor.alternatives?.find((c) => c.type === 'blockNumber');

  if (blockCursor && blockCursor.type === 'blockNumber' && config.supportedCursorTypes.includes('blockNumber')) {
    // Only apply replay window during cross-provider failover to prevent gaps
    // Same-provider resumes use exact cursor value to avoid redundant fetches
    const adjusted = config.isFailover ? config.applyReplayWindow(blockCursor) : blockCursor;
    resolved.fromBlock = typeof adjusted.value === 'number' ? adjusted.value : Number(adjusted.value);
    logger.info(
      `Resuming from block ${adjusted.value}${config.isFailover ? ' (with replay window)' : ' (exact cursor)'}`
    );
    return resolved;
  }

  const timestampCursor =
    resumeCursor.primary.type === 'timestamp'
      ? resumeCursor.primary
      : resumeCursor.alternatives?.find((c) => c.type === 'timestamp');

  if (timestampCursor && timestampCursor.type === 'timestamp' && config.supportedCursorTypes.includes('timestamp')) {
    // Only apply replay window during cross-provider failover to prevent gaps
    // Same-provider resumes use exact cursor value to avoid redundant fetches
    const adjusted = config.isFailover ? config.applyReplayWindow(timestampCursor) : timestampCursor;
    resolved.fromTimestamp = typeof adjusted.value === 'number' ? adjusted.value : Number(adjusted.value);
    logger.info(
      `Resuming from timestamp ${adjusted.value}${config.isFailover ? ' (with replay window)' : ' (exact cursor)'}`
    );
    return resolved;
  }

  // No compatible cursor found
  logger.warn('No compatible cursor found, starting from beginning');
  return resolved;
}

/**
 * Result type for API key validation
 */
export interface ApiKeyValidationResult {
  available: boolean;
  envVar: string;
}

/**
 * Validate that required API key is available in environment
 * Pure function - checks env vars and returns validation result
 */
export function validateProviderApiKey(
  metadata: Pick<ProviderMetadata, 'apiKeyEnvVar' | 'displayName' | 'name' | 'requiresApiKey'>
): ApiKeyValidationResult {
  const envVar = metadata.apiKeyEnvVar || `${metadata.name.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  const apiKey = process.env[envVar];
  const available = Boolean(apiKey && apiKey !== 'YourApiKeyToken');

  return {
    available,
    envVar,
  };
}

/**
 * Build helpful error message when preferred provider is not found
 */
export function buildProviderNotFoundError(
  blockchain: string,
  preferredProvider: string,
  availableProviders: string[]
): string {
  const providersList = availableProviders.join(', ');
  const suggestions = [
    `Available providers for ${blockchain}: ${providersList}`,
    `Run 'pnpm run providers:list --blockchain ${blockchain}' to see all options`,
    `Check for typos in provider name: '${preferredProvider}'`,
    `Use 'pnpm run providers:sync --fix' to sync configuration`,
  ];

  return `Preferred provider '${preferredProvider}' not found for ${blockchain}.\n${suggestions.join('\n')}`;
}

/**
 * Resolve and wrap cursor for a specific provider
 *
 * Handles cross-provider failover, replay windows, and cursor translation
 * by wrapping the resolved value back into a CursorState for the provider.
 */
export function resolveCursorStateForProvider(
  currentCursor: CursorState | undefined,
  provider: IBlockchainProvider,
  isFailover: boolean,
  logger: { info: (msg: string) => void; warn: (msg: string) => void }
): CursorState | undefined {
  if (!currentCursor) return undefined;

  const resolved = resolveCursorForResumption(
    currentCursor,
    {
      providerName: provider.name,
      supportedCursorTypes: provider.capabilities.supportedCursorTypes || [],
      isFailover,
      applyReplayWindow: (c) => provider.applyReplayWindow(c),
    },
    logger
  );

  if (resolved.pageToken) {
    return {
      ...currentCursor,
      primary: { type: 'pageToken' as const, value: resolved.pageToken, providerName: provider.name },
    };
  } else if (resolved.fromBlock !== undefined) {
    return {
      ...currentCursor,
      primary: { type: 'blockNumber' as const, value: resolved.fromBlock },
    };
  } else if (resolved.fromTimestamp !== undefined) {
    return {
      ...currentCursor,
      primary: { type: 'timestamp' as const, value: resolved.fromTimestamp },
    };
  }

  return currentCursor;
}
