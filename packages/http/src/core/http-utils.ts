// Pure HTTP utility functions
// All functions are pure - no side effects

import type { ErrorClassification, RateLimitHeaderInfo } from './types.js';

/**
 * Build URL from base URL and endpoint
 */
export const buildUrl = (baseUrl: string, endpoint: string): string => {
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  // If endpoint is empty or just '/', return baseUrl (for RPC endpoints with query params)
  if (!endpoint || endpoint === '' || endpoint === '/') {
    return cleanBaseUrl;
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${cleanBaseUrl}${cleanEndpoint}`;
};

/**
 * Sanitize URL for logging (remove sensitive query parameters)
 */
export const sanitizeUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);

    // List of sensitive parameter names to redact
    const sensitiveParams = ['token', 'key', 'apikey', 'api_key', 'secret', 'password'];

    for (const param of sensitiveParams) {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '***');
      }
    }

    return urlObj.toString();
  } catch {
    // If URL parsing fails, return as-is (shouldn't happen in practice)
    return url;
  }
};

/**
 * Classify HTTP error for retry logic
 */
export const classifyHttpError = (status: number, _body: string): ErrorClassification => {
  if (status === 429) {
    return { shouldRetry: true, type: 'rate_limit' };
  }

  if (status >= 500 && status < 600) {
    return { shouldRetry: false, type: 'server' };
  }

  if (status >= 400 && status < 500) {
    return { shouldRetry: false, type: 'client' };
  }

  return { shouldRetry: true, type: 'unknown' };
};

/**
 * Parse Retry-After header value
 * Supports both delay-seconds and HTTP-date formats
 */
export const parseRetryAfter = (value: string, currentTime: number): number | undefined => {
  // Try parsing as integer (delay-seconds)
  const seconds = parseInt(value, 10);
  if (!isNaN(seconds)) {
    if (seconds === 0) {
      // Invalid value, use minimum delay
      return 1000;
    }

    if (seconds > 0) {
      // RFC: numeric Retry-After is always delay-seconds.
      return Math.min(seconds * 1000, 30_000);
    }
  }

  // Try parsing as HTTP-date
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const delayMs = Math.max(0, date.getTime() - currentTime);
    if (delayMs > 0) {
      return Math.min(delayMs, 30_000);
    }
  }

  return undefined;
};

/**
 * Parse Unix timestamp and calculate delay in milliseconds
 */
export const parseUnixTimestamp = (value: string, currentTime: number): number | undefined => {
  const timestamp = parseInt(value, 10);
  if (isNaN(timestamp) || timestamp <= 0) {
    return undefined;
  }

  const now = Math.floor(currentTime / 1000); // Current time in seconds
  const delaySeconds = Math.max(0, timestamp - now);
  if (delaySeconds > 0) {
    return Math.min(delaySeconds * 1000, 30_000); // Cap at 30 seconds
  }

  return undefined;
};

/**
 * Parse rate limit headers to determine retry delay
 * Checks multiple header formats in order of preference:
 * 1. Retry-After (seconds or HTTP-date)
 * 2. X-RateLimit-Reset (Unix timestamp)
 * 3. X-Rate-Limit-Reset (Unix timestamp)
 * 4. RateLimit-Reset (delta-seconds)
 */
export const parseRateLimitHeaders = (headers: Record<string, string>, currentTime: number): RateLimitHeaderInfo => {
  // Try Retry-After first (RFC standard)
  const retryAfter = headers['retry-after'] || headers['Retry-After'];
  if (retryAfter) {
    const delayMs = parseRetryAfter(retryAfter, currentTime);
    if (delayMs !== undefined) {
      return { delayMs, source: 'Retry-After' };
    }
  }

  // Try X-RateLimit-Reset (Unix timestamp in seconds)
  const xRateLimitReset = headers['x-ratelimit-reset'] || headers['X-RateLimit-Reset'];
  if (xRateLimitReset) {
    const delayMs = parseUnixTimestamp(xRateLimitReset, currentTime);
    if (delayMs !== undefined) {
      return { delayMs, source: 'X-RateLimit-Reset' };
    }
  }

  // Try X-Rate-Limit-Reset (variant spelling)
  const xRateLimitResetVariant = headers['x-rate-limit-reset'] || headers['X-Rate-Limit-Reset'];
  if (xRateLimitResetVariant) {
    const delayMs = parseUnixTimestamp(xRateLimitResetVariant, currentTime);
    if (delayMs !== undefined) {
      return { delayMs, source: 'X-Rate-Limit-Reset' };
    }
  }

  // Try RateLimit-Reset (IETF draft standard - delta-seconds)
  const rateLimitReset = headers['ratelimit-reset'] || headers['RateLimit-Reset'];
  if (rateLimitReset) {
    const seconds = parseInt(rateLimitReset, 10);
    if (!isNaN(seconds) && seconds >= 0) {
      const delayMs = Math.min(seconds * 1000, 30_000);
      return { delayMs, source: 'RateLimit-Reset' };
    }
  }

  // No valid headers found
  return { source: 'default' };
};

/**
 * Calculate exponential backoff delay
 */
export const calculateExponentialBackoff = (attempt: number, baseDelayMs: number, maxDelayMs: number): number => {
  const delay = baseDelayMs * Math.pow(2, attempt - 1);
  return Math.min(delay, maxDelayMs);
};
