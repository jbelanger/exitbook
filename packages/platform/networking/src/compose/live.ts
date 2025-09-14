import { Effect, Layer } from 'effect';

import type { HttpClientConfig, HttpRequest } from '../http/index.js';
import { HttpClientLive, HttpClientTag } from '../http/index.js';
import type { RateLimitConfig } from '../limiter/index.js';
import { RateLimiterLive, RateLimiterTag } from '../limiter/index.js';
import type { CircuitBreakerConfig } from '../resilience/index.js';
import { CircuitBreakerLive, CircuitBreakerTag } from '../resilience/index.js';

export interface NetworkingConfig {
  circuitBreaker: CircuitBreakerConfig;
  http: HttpClientConfig;
  rateLimit: RateLimitConfig;
}

export const NetworkingDefault = (config: NetworkingConfig) =>
  Layer.mergeAll(
    HttpClientLive(config.http),
    RateLimiterLive(config.rateLimit),
    CircuitBreakerLive(config.circuitBreaker),
  );

// Individual service layers for more granular composition
export const NetworkingHttp = (config: HttpClientConfig) => HttpClientLive(config);
export const NetworkingRateLimit = (config: RateLimitConfig) => RateLimiterLive(config);
export const NetworkingCircuitBreaker = (config: CircuitBreakerConfig) =>
  CircuitBreakerLive(config);

// Convenience composition functions for common patterns
export const NetworkingWithoutCircuitBreaker = (config: Omit<NetworkingConfig, 'circuitBreaker'>) =>
  Layer.mergeAll(HttpClientLive(config.http), RateLimiterLive(config.rateLimit));

export const NetworkingWithoutRateLimit = (config: Omit<NetworkingConfig, 'rateLimit'>) =>
  Layer.mergeAll(HttpClientLive(config.http), CircuitBreakerLive(config.circuitBreaker));

export const NetworkingMinimal = (config: Pick<NetworkingConfig, 'http'>) =>
  HttpClientLive(config.http);

// Provider facade for simple "limiter → breaker → http" composition
export const call = <T>(key: string, req: HttpRequest) =>
  Effect.gen(function* () {
    const rl = yield* RateLimiterTag;
    const cb = yield* CircuitBreakerTag;
    const http = yield* HttpClientTag;
    yield* rl.waitToken(key);
    return yield* cb.execute(key, http.request<T>(req));
  });
