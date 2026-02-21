/**
 * Pure utility functions for provider health management
 *
 * Functional core — all decision logic without side effects.
 * Used by both blockchain-providers and price-providers packages.
 */

import { getCircuitStatus, isCircuitHalfOpen, isCircuitOpen } from '../circuit-breaker/circuit-breaker.js';
import type { CircuitState } from '../circuit-breaker/types.js';

import type { ProviderHealth, ProviderHealthWithCircuit } from './types.js';

/**
 * Create initial health state for a new provider
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
 * Update health metrics based on request outcome
 * Pure function — returns new health state without mutating input
 */
export function updateHealthMetrics(
  currentHealth: ProviderHealth,
  success: boolean,
  responseTime: number,
  now: number,
  errorMessage?: string
): ProviderHealth {
  const averageResponseTime = success
    ? currentHealth.averageResponseTime === 0
      ? responseTime
      : currentHealth.averageResponseTime * 0.8 + responseTime * 0.2
    : currentHealth.averageResponseTime;

  const errorWeight = success ? 0 : 1;

  return {
    ...currentHealth,
    isHealthy: success,
    lastChecked: now,
    averageResponseTime,
    consecutiveFailures: success ? 0 : currentHealth.consecutiveFailures + 1,
    lastError: success ? currentHealth.lastError : errorMessage,
    errorRate: currentHealth.errorRate * 0.9 + errorWeight * 0.1,
  };
}

/**
 * Get provider health with circuit state for monitoring
 */
export function getProviderHealthWithCircuit(
  health: ProviderHealth,
  circuitState: CircuitState,
  now: number
): ProviderHealthWithCircuit {
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
 * Check if any providers have healthy (non-open) circuits
 */
export function hasAvailableProviders(
  providers: readonly { readonly name: string }[],
  circuitMap: ReadonlyMap<string, CircuitState>,
  now: number
): boolean {
  return providers.some((provider) => {
    const circuitState = circuitMap.get(provider.name);
    return !circuitState || !isCircuitOpen(circuitState, now);
  });
}
