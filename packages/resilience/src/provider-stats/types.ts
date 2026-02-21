import type { ProviderHealth } from '../provider-health/types.js';

export interface ProviderHealthSnapshot {
  key: string;
  health: ProviderHealth;
  totalSuccesses: number;
  totalFailures: number;
}
