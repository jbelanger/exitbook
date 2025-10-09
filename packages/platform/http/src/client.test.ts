import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from './client.ts';
import type { HttpEffects } from './core/types.ts';

describe('HttpClient - Imperative Shell', () => {
  it('should make successful GET request using injected effects', async () => {
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

    expect(result).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/test',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('should enforce rate limitings', async () => {
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
          requestsPerSecond: 1, // 1 request per second
        },
      },
      mockEffects
    );

    // First request should go through immediately
    await client.get('/test1');
    expect(mockDelay).not.toHaveBeenCalled();

    // Second request should wait ~1000ms
    await client.get('/test2');
    expect(mockDelay).toHaveBeenCalled();
    expect(mockDelay.mock.calls[0]?.[0]).toBeGreaterThan(900); // Should wait ~1 second
  });

  it('should handle 429 rate limit responses with exponential backoff', async () => {
    let attempt = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt < 3) {
        return Promise.resolve({
          headers: new Headers({ 'Retry-After': '1' }),
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limited'),
        });
      }
      return Promise.resolve({
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
        ok: true,
      });
    });

    const delays: number[] = [];
    const mockEffects: HttpEffects = {
      delay: vi.fn().mockImplementation((ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      }),
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

    expect(result).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Should have exponential backoff: 1000ms, 2000ms
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
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
    await client.post('/create', body);

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
