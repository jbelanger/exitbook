/**
 * Generic provider selection: filter → score → sort
 *
 * Domain-specific filtering and bonus scoring are injected via options.
 */

import type { CircuitState } from '../circuit-breaker/types.js';
import type { IProvider, ProviderHealth } from '../provider-health/types.js';
import { scoreProviderHealth } from '../provider-scoring/provider-scoring.js';

import type { ScoredProvider, SelectProvidersOptions } from './types.js';

/**
 * Select and order providers by score (descending).
 *
 * 1. Apply optional domain filter
 * 2. Skip providers missing health or circuit state
 * 3. Score = scoreProviderHealth + optional bonusScore
 * 4. Sort descending by score
 */
export function selectProviders<TProvider extends IProvider>(
  providers: readonly TProvider[],
  healthMap: ReadonlyMap<string, ProviderHealth>,
  circuitMap: ReadonlyMap<string, CircuitState>,
  now: number,
  options?: SelectProvidersOptions<TProvider>
): ScoredProvider<TProvider>[] {
  const { filter, bonusScore } = options ?? {};

  return providers
    .filter((p) => (filter ? filter(p) : true))
    .map((provider) => {
      const health = healthMap.get(provider.name);
      const circuitState = circuitMap.get(provider.name);

      if (!health || !circuitState) {
        return;
      }

      let score = scoreProviderHealth(health, circuitState, now);
      if (bonusScore) {
        score += bonusScore(provider);
      }

      return {
        provider,
        health,
        score: Math.max(0, score),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined)
    .sort((a, b) => b.score - a.score);
}

/**
 * Build debug info JSON for provider selection logging.
 *
 * Generic — only reads .name from provider (via IProvider),
 * plus health and score from ScoredProvider.
 */
export function buildProviderSelectionDebugInfo<TProvider extends IProvider>(
  scoredProviders: ScoredProvider<TProvider>[]
): string {
  const providerInfo = scoredProviders.map((item) => ({
    avgResponseTime: Math.round(item.health.averageResponseTime),
    consecutiveFailures: item.health.consecutiveFailures,
    errorRate: Math.round(item.health.errorRate * 100),
    isHealthy: item.health.isHealthy,
    name: item.provider.name,
    score: item.score,
  }));

  return JSON.stringify(providerInfo);
}
