/**
 * In-memory store for provider health metrics and lifetime counters
 *
 * Generic (keyed by string) — no domain-specific logic.
 * Persistence is handled externally via load() and export().
 */

import { getLogger } from '@exitbook/logger';

import type { CircuitState, CircuitStatus } from '../circuit-breaker/types.js';
import {
  createInitialHealth,
  getProviderHealthWithCircuit,
  updateHealthMetrics,
} from '../provider-health/provider-health.js';
import type { ProviderHealth } from '../provider-health/types.js';

import type { ProviderHealthSnapshot } from './types.js';

const logger = getLogger('ProviderHealthStore');

export class ProviderHealthStore {
  private healthStatus = new Map<string, ProviderHealth>();
  private totalSuccesses = new Map<string, number>();
  private totalFailures = new Map<string, number>();

  initializeProvider(key: string): void {
    if (!this.healthStatus.has(key)) {
      this.healthStatus.set(key, createInitialHealth());
    }
    if (!this.totalSuccesses.has(key)) {
      this.totalSuccesses.set(key, 0);
    }
    if (!this.totalFailures.has(key)) {
      this.totalFailures.set(key, 0);
    }
  }

  getHealth(key: string): ProviderHealth | undefined {
    return this.healthStatus.get(key);
  }

  hasHealth(key: string): boolean {
    return this.healthStatus.has(key);
  }

  updateHealth(key: string, success: boolean, responseTime: number, errorMessage?: string): void {
    const currentHealth = this.healthStatus.get(key);
    if (!currentHealth) {
      logger.warn(`updateHealth called for uninitialized provider key: ${key} — call initializeProvider first`);
      return;
    }

    this.healthStatus.set(key, updateHealthMetrics(currentHealth, success, responseTime, Date.now(), errorMessage));

    if (success) {
      this.totalSuccesses.set(key, (this.totalSuccesses.get(key) ?? 0) + 1);
    } else {
      this.totalFailures.set(key, (this.totalFailures.get(key) ?? 0) + 1);
    }
  }

  getProviderHealthWithCircuit(
    key: string,
    circuitState: CircuitState,
    now: number
  ): (ProviderHealth & { circuitState: CircuitStatus }) | undefined {
    const health = this.healthStatus.get(key);
    if (!health) return undefined;
    return getProviderHealthWithCircuit(health, circuitState, now);
  }

  /**
   * Build a health map for a subset of keys, optionally remapping the key name.
   * Useful for extracting a blockchain-specific view keyed by provider.name.
   */
  getHealthMapForKeys(keys: { key: string; mapAs: string }[]): Map<string, ProviderHealth> {
    const map = new Map<string, ProviderHealth>();
    for (const { key, mapAs } of keys) {
      const health = this.healthStatus.get(key);
      if (health) map.set(mapAs, health);
    }
    return map;
  }

  getTotalSuccesses(key: string): number {
    return this.totalSuccesses.get(key) ?? 0;
  }

  getTotalFailures(key: string): number {
    return this.totalFailures.get(key) ?? 0;
  }

  /** Bulk-load pre-hydrated state (for persistence layers to call after loading from DB) */
  load(key: string, health: ProviderHealth, totalSuccesses: number, totalFailures: number): void {
    this.healthStatus.set(key, health);
    this.totalSuccesses.set(key, totalSuccesses);
    this.totalFailures.set(key, totalFailures);
  }

  /** Export current state for persistence layers to save */
  getSnapshots(): ProviderHealthSnapshot[] {
    const snapshots: ProviderHealthSnapshot[] = [];
    for (const [key, health] of this.healthStatus) {
      snapshots.push({
        key,
        health,
        totalSuccesses: this.totalSuccesses.get(key) ?? 0,
        totalFailures: this.totalFailures.get(key) ?? 0,
      });
    }
    return snapshots;
  }

  clear(): void {
    this.healthStatus.clear();
    this.totalSuccesses.clear();
    this.totalFailures.clear();
  }
}
