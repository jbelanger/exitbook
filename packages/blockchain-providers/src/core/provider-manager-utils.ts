/**
 * Utility functions for blockchain provider management
 *
 * Most functions are pure (no side effects), but deduplication helpers
 * mutate state in place for performance in hot paths.
 */

import type { CursorState, CursorType, PaginationCursor } from '@exitbook/core';
import type { CircuitState } from '@exitbook/http';
import { getCircuitStatus, isCircuitHalfOpen, isCircuitOpen } from '@exitbook/http';

import type {
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderHealth,
  ProviderOperationType,
} from './types/index.js';

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
export function supportsOperation(capabilities: ProviderCapabilities, operationType: string): boolean {
  return capabilities.supportedOperations.includes(operationType as ProviderOperationType);
}

/**
 * Select and order providers based on scores and capabilities
 * Pure function - no side effects, deterministic ordering
 */
export function selectProvidersForOperation(
  providers: IBlockchainProvider[],
  healthMap: Map<string, ProviderHealth>,
  circuitMap: Map<string, CircuitState>,
  operationType: string,
  now: number
): {
  health: ProviderHealth;
  provider: IBlockchainProvider;
  score: number;
}[] {
  return providers
    .filter((p) => supportsOperation(p.capabilities, operationType))
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
 * Check if any providers have healthy (non-open) circuits
 */
export function hasAvailableProviders(
  providers: IBlockchainProvider[],
  circuitMap: Map<string, CircuitState>,
  now: number
): boolean {
  return providers.some((p) => {
    const circuitState = circuitMap.get(p.name);
    return !circuitState || !isCircuitOpen(circuitState, now);
  });
}

/**
 * Update health metrics based on request outcome
 * Pure function - returns new health state without mutating input
 */
export function updateHealthMetrics(
  currentHealth: ProviderHealth,
  success: boolean,
  responseTime: number,
  now: number,
  errorMessage?: string
): ProviderHealth {
  const newHealth: ProviderHealth = {
    ...currentHealth,
    isHealthy: success,
    lastChecked: now,
  };

  // Update response time (exponential moving average)
  if (success) {
    newHealth.averageResponseTime =
      currentHealth.averageResponseTime === 0
        ? responseTime
        : currentHealth.averageResponseTime * 0.8 + responseTime * 0.2;
  }

  // Update failure tracking
  if (success) {
    newHealth.consecutiveFailures = 0;
  } else {
    newHealth.consecutiveFailures = currentHealth.consecutiveFailures + 1;
    newHealth.lastError = errorMessage;
  }

  // Update error rate (exponential moving average)
  const errorWeight = success ? 0 : 1;
  newHealth.errorRate = currentHealth.errorRate * 0.9 + errorWeight * 0.1;

  return newHealth;
}

/**
 * Create initial health state for a provider
 */
export function createInitialHealth(): ProviderHealth {
  return {
    averageResponseTime: 0,
    consecutiveFailures: 0,
    errorRate: 0,
    isHealthy: true,
    lastChecked: 0,
  };
}

/**
 * Get provider health with circuit state for monitoring
 */
export function getProviderHealthWithCircuit(
  health: ProviderHealth,
  circuitState: CircuitState,
  now: number
): ProviderHealth & { circuitState: string } {
  return {
    ...health,
    circuitState: getCircuitStatus(circuitState, now),
  };
}

/**
 * Determine if circuit should block request
 * Returns reason if should block, undefined if should allow
 */
export function shouldBlockDueToCircuit(
  circuitState: CircuitState,
  hasOtherProviders: boolean,
  now: number
): string | undefined {
  const isOpen = isCircuitOpen(circuitState, now);
  const isHalfOpen = isCircuitHalfOpen(circuitState, now);

  if (isOpen && hasOtherProviders) {
    return 'circuit_open';
  }

  if (isOpen && !hasOtherProviders) {
    return 'circuit_open_no_alternatives';
  }

  if (isHalfOpen) {
    return 'circuit_half_open';
  }

  return undefined;
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
export function deduplicateTransactions<T extends { normalized: { id: string } }>(
  transactions: T[],
  window: DeduplicationWindow,
  maxWindowSize: number
): T[] {
  const deduplicated: T[] = [];

  for (const tx of transactions) {
    const id = tx.normalized.id;

    if (isInDeduplicationWindow(window, id)) {
      // Skip duplicate
      continue;
    }

    // Add to results and update window
    deduplicated.push(tx);
    addToDeduplicationWindow(window, id, maxWindowSize);
  }

  return deduplicated;
}

/**
 * Load recent transaction IDs from storage to seed deduplication set
 *
 * When resuming with a replay window, we need to filter out transactions
 * that were already processed. Loading recent IDs prevents duplicates.
 *
 * This is a placeholder that will be implemented in Phase 2.3 when we add
 * storage integration to the provider manager.
 *
 * @param importSessionId - Import session to load transactions from
 * @param windowSize - Number of recent transactions to load (default: 1000)
 * @returns Promise resolving to array of transaction IDs from the last N transactions
 */
export function loadRecentTransactionIds(importSessionId: number, _windowSize = 1000): Promise<string[]> {
  // TODO: Implement in Phase 2.3
  // This will query the repository:
  // Query: SELECT external_id FROM raw_transactions
  //        WHERE import_session_id = ?
  //        ORDER BY id DESC
  //        LIMIT ?

  // Suppress unused parameter warning - will be used in Phase 2.3
  void importSessionId;

  // For now, return empty array (Phase 1-2 proof of concept only)
  return Promise.resolve([]);
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
 * Provider metadata for API key validation and configuration
 */
export interface ProviderMetadata {
  apiKeyEnvVar?: string | undefined;
  displayName: string;
  name: string;
  requiresApiKey?: boolean | undefined;
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
export function validateProviderApiKey(metadata: ProviderMetadata): ApiKeyValidationResult {
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
    `💡 Available providers for ${blockchain}: ${providersList}`,
    `💡 Run 'pnpm run providers:list --blockchain ${blockchain}' to see all options`,
    `💡 Check for typos in provider name: '${preferredProvider}'`,
    `💡 Use 'pnpm run providers:sync --fix' to sync configuration`,
  ];

  return `Preferred provider '${preferredProvider}' not found for ${blockchain}.\n${suggestions.join('\n')}`;
}
