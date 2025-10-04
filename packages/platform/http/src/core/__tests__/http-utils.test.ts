import { describe, expect, it } from 'vitest';

import {
  buildUrl,
  calculateExponentialBackoff,
  classifyHttpError,
  parseRateLimitHeaders,
  parseRetryAfter,
  parseUnixTimestamp,
  sanitizeUrl,
} from '../http-utils.ts';

describe('http-utils (pure functions)', () => {
  describe('buildUrl', () => {
    it('combines base URL and endpoint correctly', () => {
      expect(buildUrl('https://api.example.com', '/resource')).toBe('https://api.example.com/resource');
    });

    it('handles trailing slash in base URL', () => {
      expect(buildUrl('https://api.example.com/', '/resource')).toBe('https://api.example.com/resource');
    });

    it('handles missing leading slash in endpoint', () => {
      expect(buildUrl('https://api.example.com', 'resource')).toBe('https://api.example.com/resource');
    });

    it('returns base URL for empty endpoint', () => {
      expect(buildUrl('https://api.example.com/', '')).toBe('https://api.example.com');
      expect(buildUrl('https://api.example.com', '/')).toBe('https://api.example.com');
    });
  });

  describe('sanitizeUrl', () => {
    it('redacts sensitive query parameters', () => {
      const url = 'https://api.example.com/resource?token=secret123&foo=bar';
      const sanitized = sanitizeUrl(url);

      expect(sanitized).toContain('token=***');
      expect(sanitized).toContain('foo=bar');
      expect(sanitized).not.toContain('secret123');
    });

    it('redacts multiple sensitive parameters', () => {
      const url = 'https://api.example.com?key=abc&apikey=def&secret=ghi&normal=xyz';
      const sanitized = sanitizeUrl(url);

      expect(sanitized).toContain('key=***');
      expect(sanitized).toContain('apikey=***');
      expect(sanitized).toContain('secret=***');
      expect(sanitized).toContain('normal=xyz');
    });

    it('handles URLs without sensitive parameters', () => {
      const url = 'https://api.example.com/resource?foo=bar';
      const sanitized = sanitizeUrl(url);

      expect(sanitized).toBe(url);
    });

    it('returns original string on parse failure', () => {
      const invalid = 'not-a-url';
      expect(sanitizeUrl(invalid)).toBe(invalid);
    });
  });

  describe('classifyHttpError', () => {
    it('classifies 429 as rate limit with retry', () => {
      const result = classifyHttpError(429, 'Too Many Requests');

      expect(result.type).toBe('rate_limit');
      expect(result.shouldRetry).toBe(true);
    });

    it('classifies 5xx as server error without retry', () => {
      expect(classifyHttpError(500, 'Internal Server Error')).toEqual({
        shouldRetry: false,
        type: 'server',
      });
      expect(classifyHttpError(503, 'Service Unavailable')).toEqual({
        shouldRetry: false,
        type: 'server',
      });
    });

    it('classifies 4xx as client error without retry', () => {
      expect(classifyHttpError(400, 'Bad Request')).toEqual({
        shouldRetry: false,
        type: 'client',
      });
      expect(classifyHttpError(404, 'Not Found')).toEqual({
        shouldRetry: false,
        type: 'client',
      });
    });

    it('classifies other errors as unknown with retry', () => {
      expect(classifyHttpError(999, 'Unknown')).toEqual({
        shouldRetry: true,
        type: 'unknown',
      });
    });
  });

  describe('parseRetryAfter', () => {
    const currentTime = 1_000_000;

    it('parses delay in seconds', () => {
      expect(parseRetryAfter('5', currentTime)).toBe(5000);
      expect(parseRetryAfter('30', currentTime)).toBe(30_000);
    });

    it('caps delay at 30 seconds', () => {
      expect(parseRetryAfter('60', currentTime)).toBe(30_000);
    });

    it('treats large numbers as milliseconds', () => {
      expect(parseRetryAfter('500', currentTime)).toBe(500);
      expect(parseRetryAfter('5000', currentTime)).toBe(5000);
    });

    it('handles zero with minimum delay', () => {
      expect(parseRetryAfter('0', currentTime)).toBe(1000);
    });

    it('parses HTTP-date format', () => {
      const futureDate = new Date(currentTime + 5000).toUTCString();
      const delay = parseRetryAfter(futureDate, currentTime);

      expect(delay).toBeGreaterThanOrEqual(4900);
      expect(delay).toBeLessThanOrEqual(5100);
    });

    it('returns undefined for invalid values', () => {
      expect(parseRetryAfter('invalid', currentTime)).toBeUndefined();
      expect(parseRetryAfter('', currentTime)).toBeUndefined();
    });
  });

  describe('parseUnixTimestamp', () => {
    const currentTime = 1_000_000;
    const currentTimeSec = Math.floor(currentTime / 1000);

    it('calculates delay from Unix timestamp', () => {
      const futureTimestamp = (currentTimeSec + 10).toString();
      expect(parseUnixTimestamp(futureTimestamp, currentTime)).toBe(10_000);
    });

    it('caps delay at 30 seconds', () => {
      const futureTimestamp = (currentTimeSec + 60).toString();
      expect(parseUnixTimestamp(futureTimestamp, currentTime)).toBe(30_000);
    });

    it('returns undefined for past timestamps', () => {
      const pastTimestamp = (currentTimeSec - 10).toString();
      expect(parseUnixTimestamp(pastTimestamp, currentTime)).toBeUndefined();
    });

    it('returns undefined for invalid values', () => {
      expect(parseUnixTimestamp('invalid', currentTime)).toBeUndefined();
      expect(parseUnixTimestamp('0', currentTime)).toBeUndefined();
      expect(parseUnixTimestamp('-100', currentTime)).toBeUndefined();
    });
  });

  describe('parseRateLimitHeaders', () => {
    const currentTime = 1_000_000;

    it('prioritizes Retry-After header', () => {
      const headers = {
        'Retry-After': '5',
        'X-RateLimit-Reset': '999999',
      };

      const result = parseRateLimitHeaders(headers, currentTime);

      expect(result.source).toBe('Retry-After');
      expect(result.delayMs).toBe(5000);
    });

    it('falls back to X-RateLimit-Reset', () => {
      const currentTimeSec = Math.floor(currentTime / 1000);
      const headers = {
        'X-RateLimit-Reset': (currentTimeSec + 10).toString(),
      };

      const result = parseRateLimitHeaders(headers, currentTime);

      expect(result.source).toBe('X-RateLimit-Reset');
      expect(result.delayMs).toBe(10_000);
    });

    it('handles case-insensitive headers', () => {
      const headers = {
        'retry-after': '3',
      };

      const result = parseRateLimitHeaders(headers, currentTime);

      expect(result.source).toBe('Retry-After');
      expect(result.delayMs).toBe(3000);
    });

    it('tries X-Rate-Limit-Reset variant', () => {
      const currentTimeSec = Math.floor(currentTime / 1000);
      const headers = {
        'X-Rate-Limit-Reset': (currentTimeSec + 5).toString(),
      };

      const result = parseRateLimitHeaders(headers, currentTime);

      expect(result.source).toBe('X-Rate-Limit-Reset');
      expect(result.delayMs).toBe(5000);
    });

    it('tries RateLimit-Reset as last resort', () => {
      const headers = {
        'RateLimit-Reset': '7',
      };

      const result = parseRateLimitHeaders(headers, currentTime);

      expect(result.source).toBe('RateLimit-Reset');
      expect(result.delayMs).toBe(7000);
    });

    it('returns default when no valid headers found', () => {
      const headers = {};

      const result = parseRateLimitHeaders(headers, currentTime);

      expect(result.source).toBe('default');
      expect(result.delayMs).toBeUndefined();
    });

    it('skips invalid header values', () => {
      const headers = {
        'Retry-After': 'invalid',
        'X-RateLimit-Reset': 'also-invalid',
        'RateLimit-Reset': '5',
      };

      const result = parseRateLimitHeaders(headers, currentTime);

      expect(result.source).toBe('RateLimit-Reset');
      expect(result.delayMs).toBe(5000);
    });
  });

  describe('calculateExponentialBackoff', () => {
    it('calculates exponential backoff correctly', () => {
      expect(calculateExponentialBackoff(1, 1000, 60_000)).toBe(1000); // 1000 * 2^0
      expect(calculateExponentialBackoff(2, 1000, 60_000)).toBe(2000); // 1000 * 2^1
      expect(calculateExponentialBackoff(3, 1000, 60_000)).toBe(4000); // 1000 * 2^2
      expect(calculateExponentialBackoff(4, 1000, 60_000)).toBe(8000); // 1000 * 2^3
    });

    it('caps at maximum delay', () => {
      expect(calculateExponentialBackoff(10, 1000, 5000)).toBe(5000);
      expect(calculateExponentialBackoff(20, 1000, 10_000)).toBe(10_000);
    });

    it('works with different base delays', () => {
      expect(calculateExponentialBackoff(1, 500, 60_000)).toBe(500);
      expect(calculateExponentialBackoff(2, 500, 60_000)).toBe(1000);
      expect(calculateExponentialBackoff(3, 2000, 60_000)).toBe(8000);
    });
  });
});
