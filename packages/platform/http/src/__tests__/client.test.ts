import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../client.ts';
import type { HttpEffects } from '../core/types.ts';
import { ServiceError, RateLimitError } from '../types.ts';

describe('HttpClientV2 - Result Type Implementation', () => {
  it('should return ok result for successful GET request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ success: true }),
      ok: true,
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => 1000,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
      },
      mockEffects
    );

    const result = await client.get<{ success: boolean }>('/test');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ success: true });
    }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/test',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('should return error result for failed request after all retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => 1000,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
        retries: 3,
      },
      mockEffects
    );

    const result = await client.get('/test');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ServiceError);
      expect(result.error.message).toContain('service error');
    }
  });

  it('should return RateLimitError after exhausting retries on 429', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers({ 'Retry-After': '1' }),
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limited'),
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => Date.now(),
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
        retries: 2,
      },
      mockEffects
    );

    const result = await client.get('/test');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(RateLimitError);
      expect(result.error.message).toContain('rate limit exceeded');
    }
  });

  it('should retry on network errors and succeed', async () => {
    let attempt = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt < 2) {
        throw new Error('Network error');
      }
      return Promise.resolve({
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
        ok: true,
      });
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => Date.now(),
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
        retries: 3,
      },
      mockEffects
    );

    const result = await client.get('/test');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ success: true });
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should enforce rate limiting', async () => {
    let currentTime = 1000;
    const mockDelay = vi.fn().mockImplementation((ms: number) => {
      currentTime += ms;
      return Promise.resolve();
    });

    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ data: 'ok' }),
      ok: true,
    });

    const mockEffects: HttpEffects = {
      delay: mockDelay,
      fetch: mockFetch,
      log: vi.fn(),
      now: () => currentTime,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: {
          requestsPerSecond: 1,
        },
      },
      mockEffects
    );

    // First request should go through immediately
    const result1 = await client.get('/test1');
    expect(result1.isOk()).toBe(true);
    expect(mockDelay).not.toHaveBeenCalled();

    // Second request should wait ~1000ms
    const result2 = await client.get('/test2');
    expect(result2.isOk()).toBe(true);
    expect(mockDelay).toHaveBeenCalled();
    expect(mockDelay.mock.calls[0]?.[0]).toBeGreaterThan(900);
  });

  it('should handle POST requests with body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ created: true }),
      ok: true,
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => 1000,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
      },
      mockEffects
    );

    const body = { name: 'test' };
    const result = await client.post('/create', body);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ created: true });
    }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/create',
      expect.objectContaining({
        body: JSON.stringify(body),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }) as Record<string, string>,
        method: 'POST',
      })
    );
  });

  it('should return error result for 4xx client errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => 1000,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
        retries: 1,
      },
      mockEffects
    );

    const result = await client.get('/test');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('HTTP 404');
      expect(result.error.message).toContain('Not Found');
    }
  });

  it('should return error result on timeout', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('AbortError');
          error.name = 'AbortError';
          reject(error);
        }, 100);
      });
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => 1000,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
        retries: 1,
        timeout: 50,
      },
      mockEffects
    );

    const result = await client.get('/test');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('timeout');
    }
  });

  it('should support temporary rate limit override', async () => {
    let currentTime = 1000;
    const mockDelay = vi.fn().mockImplementation((ms: number) => {
      currentTime += ms;
      return Promise.resolve();
    });

    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ data: 'ok' }),
      ok: true,
    });

    const mockEffects: HttpEffects = {
      delay: mockDelay,
      fetch: mockFetch,
      log: vi.fn(),
      now: () => currentTime,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 1 },
      },
      mockEffects
    );

    // Use higher rate limit temporarily
    const restore = client.withRateLimit({ requestsPerSecond: 100 });

    const delayCallsBefore = mockDelay.mock.calls.length;
    await client.get('/test1');
    await client.get('/test2');
    await client.get('/test3');

    // Should not have significantly delayed with high rate limit
    const significantDelays = mockDelay.mock.calls.slice(delayCallsBefore).filter((call) => call[0] > 100).length;
    expect(significantDelays).toBe(0);

    // Restore original rate limit
    restore();

    const delayCallsBeforeRestore = mockDelay.mock.calls.length;
    await client.get('/test4');
    await client.get('/test5');

    // Now should enforce the original 1 req/sec limit with significant delays
    const delaysAfterRestore = mockDelay.mock.calls.slice(delayCallsBeforeRestore);
    const significantDelaysAfterRestore = delaysAfterRestore.filter((call) => call[0] > 100).length;
    expect(significantDelaysAfterRestore).toBeGreaterThan(0);
  });

  it('should sanitize URLs in logs', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ data: 'ok' }),
      ok: true,
    });

    const logSpy = vi.fn();
    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: logSpy,
      now: () => 1000,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
      },
      mockEffects
    );

    await client.get('/test?apikey=secret123');

    // Check that the log was called with sanitized URL
    const debugLogs = logSpy.mock.calls.filter((call) => call[0] === 'debug');
    const requestLog = debugLogs.find((call) => (call[1] as string).includes('Making HTTP request'));

    expect(requestLog).toBeDefined();
    expect((requestLog as unknown[])[1]).toContain('apikey=***');
    expect((requestLog as unknown[])[1]).not.toContain('secret123');
  });
});
