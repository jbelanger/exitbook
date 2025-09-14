import { Context, Effect, Layer, Ref } from 'effect';

import type { CircuitBreakerConfig, CircuitBreakerStats, CircuitState } from './types.js';
import { CircuitBreakerOpenError } from './types.js';

interface CircuitBreakerState {
  failureCount: number;
  lastFailureTimestamp: number;
  lastSuccessTimestamp: number;
}

export interface CircuitBreaker {
  readonly execute: <A, E>(
    key: string,
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | CircuitBreakerOpenError, never>;
  readonly getState: (key: string) => Effect.Effect<CircuitState, never, never>;
  readonly getStats: (key: string) => Effect.Effect<CircuitBreakerStats, never, never>;
  readonly recordFailure: (key: string) => Effect.Effect<void, never, never>;
  readonly recordSuccess: (key: string) => Effect.Effect<void, never, never>;
  readonly reset: (key?: string) => Effect.Effect<void, never, never>;
}

export const CircuitBreakerTag = Context.GenericTag<CircuitBreaker>(
  '@exitbook/platform-networking/CircuitBreaker',
);

export const CircuitBreakerLive = (config: CircuitBreakerConfig) =>
  Layer.effect(
    CircuitBreakerTag,
    Effect.gen(function* () {
      const circuits = yield* Ref.make(new Map<string, CircuitBreakerState>());

      const getCircuit = (key: string) =>
        Effect.gen(function* () {
          const currentCircuits = yield* Ref.get(circuits);
          const existing = currentCircuits.get(key);

          if (existing) {
            return existing;
          }

          const newCircuit: CircuitBreakerState = {
            failureCount: 0,
            lastFailureTimestamp: 0,
            lastSuccessTimestamp: 0,
          };

          yield* Ref.update(circuits, (map) => new Map(map).set(key, newCircuit));
          return newCircuit;
        });

      const updateCircuit = (key: string, circuit: CircuitBreakerState) =>
        Ref.update(circuits, (map) => new Map(map).set(key, circuit));

      const getCurrentState = (circuit: CircuitBreakerState): CircuitState => {
        if (circuit.failureCount < config.maxFailures) return 'closed';

        const timeSinceLastFailure = Date.now() - circuit.lastFailureTimestamp;
        if (timeSinceLastFailure >= config.recoveryTimeoutMs) return 'half-open';

        return 'open';
      };

      const getStatsFromCircuit = (circuit: CircuitBreakerState): CircuitBreakerStats => {
        const state = getCurrentState(circuit);
        const timeSinceLastFailure = circuit.lastFailureTimestamp
          ? Date.now() - circuit.lastFailureTimestamp
          : 0;
        const timeUntilRecovery =
          state === 'open' ? config.recoveryTimeoutMs - timeSinceLastFailure : 0;

        return {
          failureCount: circuit.failureCount,
          lastFailureTimestamp: circuit.lastFailureTimestamp,
          lastSuccessTimestamp: circuit.lastSuccessTimestamp,
          maxFailures: config.maxFailures,
          state,
          timeSinceLastFailureMs: timeSinceLastFailure,
          timeUntilRecoveryMs: Math.max(0, timeUntilRecovery),
        };
      };

      return {
        execute: <A, E>(key: string, effect: Effect.Effect<A, E>) =>
          Effect.gen(function* () {
            const circuit = yield* getCircuit(key);
            const state = getCurrentState(circuit);

            if (state === 'open') {
              const stats = getStatsFromCircuit(circuit);
              return yield* Effect.fail(
                new CircuitBreakerOpenError(`Circuit breaker is open for key: ${key}`, key, stats),
              );
            }

            // Use Effect.matchEffect to properly handle typed failures
            return yield* Effect.matchEffect(effect, {
              onFailure: (err) =>
                Effect.gen(function* () {
                  // Record failure
                  const failureCircuit: CircuitBreakerState = {
                    ...circuit,
                    failureCount: circuit.failureCount + 1,
                    lastFailureTimestamp: Date.now(),
                  };
                  yield* updateCircuit(key, failureCircuit);
                  return yield* Effect.fail(err);
                }),
              onSuccess: (result) =>
                Effect.gen(function* () {
                  // Record success
                  const successCircuit: CircuitBreakerState = {
                    failureCount: 0,
                    lastFailureTimestamp: 0,
                    lastSuccessTimestamp: Date.now(),
                  };
                  yield* updateCircuit(key, successCircuit);
                  return result;
                }),
            });
          }),

        getState: (key: string) =>
          Effect.gen(function* () {
            const circuit = yield* getCircuit(key);
            return getCurrentState(circuit);
          }),

        getStats: (key: string) =>
          Effect.gen(function* () {
            const circuit = yield* getCircuit(key);
            return getStatsFromCircuit(circuit);
          }),

        recordFailure: (key: string) =>
          Effect.gen(function* () {
            const circuit = yield* getCircuit(key);
            const failureCircuit: CircuitBreakerState = {
              ...circuit,
              failureCount: circuit.failureCount + 1,
              lastFailureTimestamp: Date.now(),
            };
            yield* updateCircuit(key, failureCircuit);
          }),

        recordSuccess: (key: string) =>
          Effect.gen(function* () {
            const successCircuit: CircuitBreakerState = {
              failureCount: 0,
              lastFailureTimestamp: 0,
              lastSuccessTimestamp: Date.now(),
            };
            yield* updateCircuit(key, successCircuit);
          }),

        reset: (key?: string) =>
          Effect.gen(function* () {
            if (key) {
              yield* Ref.update(circuits, (map) => {
                const newMap = new Map(map);
                newMap.delete(key);
                return newMap;
              });
            } else {
              yield* Ref.set(circuits, new Map());
            }
          }),
      };
    }),
  );
