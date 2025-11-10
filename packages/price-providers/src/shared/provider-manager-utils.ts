/**
 * Pure utility functions for provider management
 *
 * Functional core - all decision logic without side effects
 */

import type { CircuitState } from '@exitbook/platform-http';
import { getCircuitStatus, isCircuitHalfOpen, isCircuitOpen } from '@exitbook/platform-http';

import type { IPriceProvider, ProviderHealth, ProviderMetadata } from './types/index.js';

/**
 * Check if cache entry is still valid
 */
export function isCacheValid(expiry: number, now: number): boolean {
  return expiry > now;
}

/**
 * Calculate granularity bonus for a provider based on timestamp and capabilities
 * Pure function - returns bonus score based on provider's declared granularity support
 */
export function calculateGranularityBonus(metadata: ProviderMetadata, timestamp: Date, now: number): number {
  const diffMs = now - timestamp.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Check if this is an intraday request (not midnight UTC)
  const isIntradayRequest =
    timestamp.getUTCHours() !== 0 || timestamp.getUTCMinutes() !== 0 || timestamp.getUTCSeconds() !== 0;

  if (!isIntradayRequest) {
    return 0; // No bonus for daily requests
  }

  // Provider must declare granularity support
  if (!metadata.capabilities.granularitySupport || metadata.capabilities.granularitySupport.length === 0) {
    // Default to assuming only daily data available
    return -10; // Penalty for not supporting intraday
  }

  // Find best available granularity for this timestamp age
  let bestGranularity: 'minute' | 'hour' | 'day' | undefined;
  let bestBonus = 0;

  for (const support of metadata.capabilities.granularitySupport) {
    // Check if this granularity is available for the requested timestamp age
    const isAvailable = support.maxHistoryDays === undefined || diffDays <= support.maxHistoryDays;

    if (isAvailable) {
      // Assign bonus based on granularity level
      let bonus = 0;
      if (support.granularity === 'minute') {
        bonus = 30; // Highest priority for minute data
      } else if (support.granularity === 'hour') {
        bonus = 20; // High priority for hourly data
      } else if (support.granularity === 'day') {
        bonus = 0; // No bonus for daily (baseline)
      }

      // Track the best (highest bonus) available granularity
      if (bonus > bestBonus) {
        bestBonus = bonus;
        bestGranularity = support.granularity;
      }
    }
  }

  // If only daily data available for intraday request, penalize
  if (bestGranularity === 'day' || bestGranularity === undefined) {
    return -10; // Penalty for not supporting intraday when needed
  }

  return bestBonus;
}

/**
 * Score a provider based on health, performance, and priority
 * Pure function - takes all context as parameters
 */
export function scoreProvider(
  metadata: ProviderMetadata,
  health: ProviderHealth,
  circuitState: CircuitState,
  now: number,
  timestamp?: Date
): number {
  let score = 100; // Base score

  // Circuit breaker penalties
  if (isCircuitOpen(circuitState, now)) score -= 100;
  if (isCircuitHalfOpen(circuitState, now)) score -= 25;

  // Health penalties
  if (!health.isHealthy) score -= 50;

  // Performance bonuses/penalties
  if (health.averageResponseTime < 1000) score += 20; // Fast response
  if (health.averageResponseTime > 5000) score -= 30; // Slow response

  // Error rate penalties (0-50 points)
  score -= health.errorRate * 50;

  // Consecutive failure penalties
  score -= health.consecutiveFailures * 10;

  // Granularity bonus (if timestamp provided)
  if (timestamp) {
    score += calculateGranularityBonus(metadata, timestamp, now);
  }

  return Math.max(0, score);
}

/**
 * Check if provider supports the requested operation
 */
export function supportsOperation(metadata: ProviderMetadata, operationType: string): boolean {
  return metadata.capabilities.supportedOperations.includes(operationType as 'fetchPrice' | 'fetchHistoricalRange');
}

/**
 * Check if provider supports the requested asset
 * Pure function - determines if provider can price a specific asset
 *
 * @param metadata - Provider metadata with capabilities
 * @param assetSymbol - Asset symbol to check (e.g., 'BTC', 'EUR', 'CAD')
 * @param isFiat - Whether the asset is a fiat currency
 * @returns true if provider supports this asset
 */
export function supportsAsset(metadata: ProviderMetadata, assetSymbol: string, isFiat: boolean): boolean {
  // Check asset type first (crypto vs fiat)
  const assetType = isFiat ? 'fiat' : 'crypto';
  if (!metadata.capabilities.supportedAssetTypes.includes(assetType)) {
    return false;
  }

  // If supportedAssets is undefined/empty, provider supports all assets of that type
  if (!metadata.capabilities.supportedAssets || metadata.capabilities.supportedAssets.length === 0) {
    return true;
  }

  // Otherwise, check if specific asset is in the list
  return metadata.capabilities.supportedAssets.includes(assetSymbol);
}

/**
 * Select and order providers based on scores and capabilities
 * Pure function - no side effects, deterministic ordering
 */
export function selectProvidersForOperation(
  providers: IPriceProvider[],
  healthMap: Map<string, ProviderHealth>,
  circuitMap: Map<string, CircuitState>,
  operationType: string,
  now: number,
  timestamp?: Date,
  assetSymbol?: string,
  isFiat?: boolean
): {
  health: ProviderHealth;
  metadata: ProviderMetadata;
  provider: IPriceProvider;
  score: number;
}[] {
  return providers
    .map((provider) => {
      const metadata = provider.getMetadata();
      const health = healthMap.get(metadata.name);
      const circuitState = circuitMap.get(metadata.name);

      // Skip if missing health or circuit state
      if (!health || !circuitState) {
        return;
      }

      // Skip if doesn't support operation
      if (!supportsOperation(metadata, operationType)) {
        return;
      }

      // Skip if doesn't support the requested asset
      if (assetSymbol !== undefined && isFiat !== undefined) {
        if (!supportsAsset(metadata, assetSymbol, isFiat)) {
          return;
        }
      }

      return {
        health,
        metadata,
        provider,
        score: scoreProvider(metadata, health, circuitState, now, timestamp),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .sort((a, b) => b.score - a.score); // Higher score first
}

/**
 * Check if any providers have healthy (non-open) circuits
 */
export function hasAvailableProviders(
  providers: IPriceProvider[],
  circuitMap: Map<string, CircuitState>,
  now: number
): boolean {
  return providers.some((p) => {
    const circuitState = circuitMap.get(p.getMetadata().name);
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
    // Don't clear lastError - keep it for debugging
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
    metadata: ProviderMetadata;
    provider: IPriceProvider;
    score: number;
  }[]
): string {
  const providerInfo = scoredProviders.map((item) => ({
    avgResponseTime: Math.round(item.health.averageResponseTime),
    consecutiveFailures: item.health.consecutiveFailures,
    errorRate: Math.round(item.health.errorRate * 100),
    isHealthy: item.health.isHealthy,
    name: item.metadata.name,
    score: item.score,
  }));

  return JSON.stringify(providerInfo);
}
