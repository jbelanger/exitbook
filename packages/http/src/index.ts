export { HttpClient } from './client.js';

export { HttpError, RateLimitError, ResponseValidationError } from './types.js';
export type { HttpClientConfig, HttpClientHooks, HttpRequestOptions, RateLimitConfig } from './types.js';

export { sanitizeEndpoint } from './instrumentation.js';

export {
  calculateWaitTime,
  canMakeRequestInAllWindows,
  cleanOldTimestamps,
  consumeToken,
  getRateLimitStatus,
  getRequestCountInWindow,
  refillTokens,
  shouldAllowRequest,
} from './core/rate-limit.js';

export {
  buildUrl,
  calculateExponentialBackoff,
  classifyHttpError,
  parseRateLimitHeaders,
  parseRetryAfter,
  parseUnixTimestamp,
  sanitizeUrl,
} from './core/http-utils.js';

export {
  createInitialRateLimitState,
  type ErrorClassification,
  type HttpEffects,
  type RateLimitHeaderInfo,
  type RateLimitState,
} from './core/types.js';
