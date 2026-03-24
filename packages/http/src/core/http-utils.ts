import type { ErrorClassification, RateLimitHeaderInfo } from './types.js';

export const buildUrl = (baseUrl: string, endpoint: string): string => {
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  if (!endpoint || endpoint === '' || endpoint === '/') {
    return cleanBaseUrl;
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${cleanBaseUrl}${cleanEndpoint}`;
};

export const sanitizeUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const sensitiveParams = ['token', 'key', 'apikey', 'api_key', 'secret', 'password'];

    for (const param of sensitiveParams) {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '***');
      }
    }

    return urlObj.toString();
  } catch {
    return url;
  }
};

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

export const parseRetryAfter = (value: string, currentTime: number): number | undefined => {
  const seconds = parseInt(value, 10);
  if (!isNaN(seconds)) {
    if (seconds === 0) {
      return 1000;
    }

    if (seconds > 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }

  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const delayMs = Math.max(0, date.getTime() - currentTime);
    if (delayMs > 0) {
      return Math.min(delayMs, 30_000);
    }
  }

  return undefined;
};

export const parseUnixTimestamp = (value: string, currentTime: number): number | undefined => {
  const timestamp = parseInt(value, 10);
  if (isNaN(timestamp) || timestamp <= 0) {
    return undefined;
  }

  const now = Math.floor(currentTime / 1000);
  const delaySeconds = Math.max(0, timestamp - now);
  if (delaySeconds > 0) {
    return Math.min(delaySeconds * 1000, 30_000);
  }

  return undefined;
};

export const parseRateLimitHeaders = (headers: Record<string, string>, currentTime: number): RateLimitHeaderInfo => {
  const retryAfter = headers['retry-after'] || headers['Retry-After'];
  if (retryAfter) {
    const delayMs = parseRetryAfter(retryAfter, currentTime);
    if (delayMs !== undefined) {
      return { delayMs, source: 'Retry-After' };
    }
  }

  const xRateLimitReset = headers['x-ratelimit-reset'] || headers['X-RateLimit-Reset'];
  if (xRateLimitReset) {
    const delayMs = parseUnixTimestamp(xRateLimitReset, currentTime);
    if (delayMs !== undefined) {
      return { delayMs, source: 'X-RateLimit-Reset' };
    }
  }

  const xRateLimitResetVariant = headers['x-rate-limit-reset'] || headers['X-Rate-Limit-Reset'];
  if (xRateLimitResetVariant) {
    const delayMs = parseUnixTimestamp(xRateLimitResetVariant, currentTime);
    if (delayMs !== undefined) {
      return { delayMs, source: 'X-Rate-Limit-Reset' };
    }
  }

  const rateLimitReset = headers['ratelimit-reset'] || headers['RateLimit-Reset'];
  if (rateLimitReset) {
    const seconds = parseInt(rateLimitReset, 10);
    if (!isNaN(seconds) && seconds >= 0) {
      const delayMs = Math.min(seconds * 1000, 30_000);
      return { delayMs, source: 'RateLimit-Reset' };
    }
  }

  return { source: 'default' };
};

export const calculateExponentialBackoff = (attempt: number, baseDelayMs: number, maxDelayMs: number): number => {
  const delay = baseDelayMs * Math.pow(2, attempt - 1);
  return Math.min(delay, maxDelayMs);
};
