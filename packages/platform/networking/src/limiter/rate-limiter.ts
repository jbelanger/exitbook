import { Context, Effect, Layer, Ref } from 'effect';

import { recordRateLimiterWait } from '../metrics/index.js';

import type { RateLimitConfig, RateLimitStatus } from './types.js';

interface TokenBucketState {
  lastRefill: number;
  tokens: number;
}

export interface RateLimiter {
  readonly canMakeRequest: (key: string) => Effect.Effect<boolean, never, never>;
  readonly getStatus: (key: string) => Effect.Effect<RateLimitStatus, never, never>;
  readonly reset: (key?: string) => Effect.Effect<void, never, never>;
  readonly waitToken: (key: string) => Effect.Effect<void, never, never>;
}

export const RateLimiterTag = Context.GenericTag<RateLimiter>(
  '@exitbook/platform-networking/RateLimiter',
);

export const RateLimiterLive = (config: RateLimitConfig) =>
  Layer.effect(
    RateLimiterTag,
    Effect.gen(function* () {
      const buckets = yield* Ref.make(new Map<string, TokenBucketState>());

      // Normalize all rate limits to requests per second (use the most restrictive)
      const normalizeRateToRPS = () => {
        const rates: number[] = [config.requestsPerSecond];

        if (config.requestsPerMinute !== undefined) {
          rates.push(config.requestsPerMinute / 60);
        }

        if (config.requestsPerHour !== undefined) {
          rates.push(config.requestsPerHour / 3600);
        }

        return Math.min(...rates);
      };

      const effectiveRPS = normalizeRateToRPS();

      const waitToken = (key: string): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          const result = yield* Ref.modify(buckets, (map) => {
            const now = Date.now();
            const current = map.get(key) ?? {
              lastRefill: now,
              tokens: config.burstLimit ?? 1,
            };

            const elapsed = (now - current.lastRefill) / 1000;
            const max = config.burstLimit || 1;

            const refilled = Math.min(max, current.tokens + elapsed * effectiveRPS);

            if (refilled >= 1) {
              const updated = { lastRefill: now, tokens: refilled - 1 };
              const nextMap = new Map(map).set(key, updated);
              return [undefined, nextMap] as const; // success, updated map
            }

            // Calculate precise wait time based on deficit
            const deficit = 1 - refilled;
            const waitMs = Math.ceil((deficit / effectiveRPS) * 1000);
            return [waitMs, map] as const;
          });

          if (result === undefined) {
            return;
          }

          yield* Effect.all(recordRateLimiterWait(key, result));
          yield* Effect.sleep(result);
          return yield* waitToken(key);
        });

      return {
        canMakeRequest: (key: string) =>
          Ref.modify(buckets, (map) => {
            const now = Date.now();
            const current = map.get(key) ?? {
              lastRefill: now,
              tokens: config.burstLimit ?? 1,
            };

            const elapsed = (now - current.lastRefill) / 1000;
            const max = config.burstLimit || 1;

            const refilled = Math.min(max, current.tokens + elapsed * effectiveRPS);
            const updated = { lastRefill: now, tokens: refilled };
            const nextMap = new Map(map).set(key, updated);

            return [refilled >= 1, nextMap] as const;
          }),

        getStatus: (key: string) =>
          Ref.modify(buckets, (map) => {
            const now = Date.now();
            const current = map.get(key) ?? {
              lastRefill: now,
              tokens: config.burstLimit ?? 1,
            };

            const elapsed = (now - current.lastRefill) / 1000;
            const max = config.burstLimit || 1;

            const refilled = Math.min(max, current.tokens + elapsed * effectiveRPS);
            const updated = { lastRefill: now, tokens: refilled };
            const nextMap = new Map(map).set(key, updated);

            const status: RateLimitStatus = {
              maxTokens: config.burstLimit || 1,
              requestsPerSecond: effectiveRPS,
              tokens: refilled,
            };

            return [status, nextMap] as const;
          }),

        reset: (key?: string) =>
          Effect.gen(function* () {
            if (key) {
              yield* Ref.update(buckets, (map) => {
                const newMap = new Map(map);
                newMap.delete(key);
                return newMap;
              });
            } else {
              yield* Ref.set(buckets, new Map());
            }
          }),

        waitToken,
      };
    }),
  );
