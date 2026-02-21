/**
 * Shared provider scoring based on health metrics and circuit state
 *
 * Returns a base score; domain-specific bonuses (rate limits, granularity)
 * are added by callers via simple arithmetic composition.
 */

import { isCircuitHalfOpen, isCircuitOpen } from '../circuit-breaker/circuit-breaker.js';
import type { CircuitState } from '../circuit-breaker/types.js';
import type { ProviderHealth } from '../provider-health/types.js';

/**
 * Score a provider based on health metrics and circuit breaker state.
 *
 * Formula:
 * - Base: 100
 * - Circuit: open −100, half-open −25
 * - Health: unhealthy −50
 * - Response time: <1s +20, >5s −30
 * - Error rate: −(errorRate × 50)
 * - Consecutive failures: −(count × 10)
 *
 * Returns the raw score (may be negative). Callers add domain-specific
 * deltas and clamp with Math.max(0, score).
 */
export function scoreProviderHealth(health: ProviderHealth, circuitState: CircuitState, now: number): number {
  let score = 100;

  // Circuit breaker penalties
  if (isCircuitOpen(circuitState, now)) score -= 100;
  if (isCircuitHalfOpen(circuitState, now)) score -= 25;

  // Health penalties
  if (!health.isHealthy) score -= 50;

  // Performance bonuses/penalties
  if (health.averageResponseTime < 1000) score += 20;
  if (health.averageResponseTime > 5000) score -= 30;

  // Error rate penalties (0-50 points)
  score -= health.errorRate * 50;

  // Consecutive failure penalties
  score -= health.consecutiveFailures * 10;

  return score;
}
