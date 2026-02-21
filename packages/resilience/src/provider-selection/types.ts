import type { IProvider, ProviderHealth } from '../provider-health/types.js';

export interface ScoredProvider<TProvider extends IProvider> {
  provider: TProvider;
  health: ProviderHealth;
  score: number;
}

export interface SelectProvidersOptions<TProvider extends IProvider> {
  /** Domain-specific filter (e.g., supports operation, supports asset) */
  filter?: (provider: TProvider) => boolean;
  /** Domain-specific bonus score (e.g., rate-limit, granularity) */
  bonusScore?: (provider: TProvider) => number;
}
