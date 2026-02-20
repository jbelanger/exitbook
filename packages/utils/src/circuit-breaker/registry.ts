import { recordFailure, recordSuccess, resetCircuit } from './circuit-breaker.js';
import { createInitialCircuitState } from './types.js';
import type { CircuitState } from './types.js';

/**
 * Stateful registry for circuit breaker state keyed by provider identifier.
 */
export class CircuitBreakerRegistry {
  private states = new Map<string, CircuitState>();

  getOrCreate(providerKey: string): CircuitState {
    let state = this.states.get(providerKey);
    if (!state) {
      state = createInitialCircuitState();
      this.states.set(providerKey, state);
    }
    return state;
  }

  get(providerKey: string): CircuitState | undefined {
    return this.states.get(providerKey);
  }

  set(providerKey: string, state: CircuitState): void {
    this.states.set(providerKey, state);
  }

  has(providerKey: string): boolean {
    return this.states.has(providerKey);
  }

  recordSuccess(providerKey: string, now: number): CircuitState {
    const state = this.getOrCreate(providerKey);
    const next = recordSuccess(state, now);
    this.states.set(providerKey, next);
    return next;
  }

  recordFailure(providerKey: string, now: number): CircuitState {
    const state = this.getOrCreate(providerKey);
    const next = recordFailure(state, now);
    this.states.set(providerKey, next);
    return next;
  }

  reset(providerKey: string): void {
    const state = this.states.get(providerKey);
    if (state) {
      this.states.set(providerKey, resetCircuit(state));
    }
  }

  entries(): IterableIterator<[string, CircuitState]> {
    return this.states.entries();
  }

  asReadonlyMap(): ReadonlyMap<string, CircuitState> {
    return this.states;
  }

  clear(): void {
    this.states.clear();
  }
}
