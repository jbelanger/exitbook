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
 * Score a provider based on health, performance, and priority
 * Pure function - takes all context as parameters
 */
export function scoreProvider(
  metadata: ProviderMetadata,
  health: ProviderHealth,
  circuitState: CircuitState,
  now: number
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

  return Math.max(0, score);
}

/**
 * Check if provider supports the requested operation
 */
export function supportsOperation(metadata: ProviderMetadata, operationType: string): boolean {
  return metadata.capabilities.supportedOperations.includes(operationType as 'fetchPrice' | 'fetchHistoricalRange');
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
  now: number
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

      return {
        health,
        metadata,
        provider,
        score: scoreProvider(metadata, health, circuitState, now),
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
