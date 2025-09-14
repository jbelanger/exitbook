// HTTP Client exports
export { HttpClientTag } from './http/index.js';
export type { HttpRequest, HttpResponse, HttpClient, HttpClientConfig } from './http/index.js';
export { HttpError, HttpTimeoutError } from './http/index.js';

// Rate Limiter exports
export { RateLimiterTag } from './limiter/index.js';
export type { RateLimiter, RateLimitConfig, RateLimitStatus } from './limiter/index.js';
export { RateLimitError } from './limiter/index.js';

// Circuit Breaker exports
export { CircuitBreakerTag } from './resilience/index.js';
export type {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitState,
} from './resilience/index.js';
export { CircuitBreakerOpenError } from './resilience/index.js';

// Auth helpers
export type {
  ApiKeyAuthConfig,
  HmacAuthConfig,
  JwtAuthConfig,
  AuthConfig,
  MessageBuilder,
} from './auth/index.js';
export { AuthHelpers } from './auth/index.js';

// Metrics
export {
  NetworkingMetrics,
  recordHttpRequest,
  recordHttpError,
  recordRateLimiterWait,
  recordCircuitBreakerStateChange,
} from './metrics/index.js';

// Composition layers
export { NetworkingDefault } from './compose/index.js';
export type { NetworkingConfig } from './compose/index.js';
export {
  NetworkingHttp,
  NetworkingRateLimit,
  NetworkingCircuitBreaker,
  NetworkingWithoutCircuitBreaker,
  NetworkingWithoutRateLimit,
  NetworkingMinimal,
} from './compose/index.js';

// Testing utilities
export {
  NetworkingTestkit,
  TestHttpClientTag,
  InMemoryRateLimiterLive,
  InMemoryCircuitBreakerLive,
} from './testing/index.js';
export type { TestHttpClient, MockHttpResponse } from './testing/index.js';
