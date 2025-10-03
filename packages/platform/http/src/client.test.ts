import type { Mock } from 'vitest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@exitbook/shared-logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

interface RateLimiterStub {
  getStatus: Mock;
  waitForPermission: Mock;
}

const { getOrCreateMock, resetFactoryMock } = vi.hoisted(() => ({
  getOrCreateMock: vi.fn<(provider: string, config: RateLimitConfig) => RateLimiterStub>(),
  resetFactoryMock: vi.fn<(provider?: string) => void>(),
}));

vi.mock('./rate-limiter.js', () => ({
  RateLimiterFactory: {
    getOrCreate: getOrCreateMock,
    reset: resetFactoryMock,
  },
}));

import { HttpClient } from './client.ts';
import { RateLimitError, ServiceError } from './types.ts';
import type { RateLimitConfig } from './types.ts';

const createRateLimiterStub = (): RateLimiterStub => ({
  getStatus: vi.fn(),
  waitForPermission: vi.fn(),
});

const fetchMock = vi.fn<typeof fetch>();

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  getOrCreateMock.mockReset();
  resetFactoryMock.mockReset();
  vi.clearAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('HttpClient', () => {
  it('performs GET requests with merged headers and returns parsed JSON', async () => {
    const limiter = createRateLimiterStub();
    limiter.waitForPermission.mockResolvedValue(void 0);
    limiter.getStatus.mockReturnValue({ tokens: 1 });
    getOrCreateMock.mockReturnValue(limiter);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ hello: 'world' }), {
        headers: new Headers({ 'Content-Type': 'application/json' }),
        status: 200,
      })
    );

    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      providerName: 'example',
      rateLimit: { requestsPerSecond: 10 },
    });

    const result = await client.get('/resource', {
      headers: { Authorization: 'Bearer token' },
      timeout: 5_000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/resource');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer token',
      'User-Agent': 'exitbook/1.0.0',
    });
    expect(init?.body).toBeNull();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ hello: 'world' });
    expect(limiter.waitForPermission).toHaveBeenCalledTimes(1);
  });

  it('retries on rate limits and throws RateLimitError when retries exhausted', async () => {
    const limiter = createRateLimiterStub();
    limiter.waitForPermission.mockResolvedValue(void 0);
    getOrCreateMock.mockReturnValue(limiter);

    const retryAfterHeaders = new Headers({ 'Retry-After': '5' });

    fetchMock
      .mockResolvedValueOnce(
        new Response('Too Many Requests', {
          headers: retryAfterHeaders,
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response('Still rate limited', {
          headers: retryAfterHeaders,
          status: 429,
        })
      )
      .mockResolvedValueOnce(
        new Response('Nope', {
          headers: retryAfterHeaders,
          status: 429,
        })
      );

    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      providerName: 'example',
      rateLimit: { requestsPerSecond: 10 },
    });

    const delaySpy = vi
      .spyOn(client as unknown as { delay: (ms: number) => Promise<void> }, 'delay')
      .mockResolvedValue();

    try {
      await expect(client.get('/resource')).rejects.toBeInstanceOf(RateLimitError);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(delaySpy).toHaveBeenNthCalledWith(1, 5_000);
      expect(delaySpy).toHaveBeenNthCalledWith(2, 10_000);
      expect(limiter.waitForPermission).toHaveBeenCalledTimes(1);
    } finally {
      delaySpy.mockRestore();
    }
  });

  it('throws ServiceError for server errors and does not retry', async () => {
    const limiter = createRateLimiterStub();
    limiter.waitForPermission.mockResolvedValue(void 0);
    getOrCreateMock.mockReturnValue(limiter);

    fetchMock.mockResolvedValue(
      new Response('Internal Server Error', {
        status: 500,
      })
    );

    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      providerName: 'example',
      rateLimit: { requestsPerSecond: 10 },
    });

    await expect(client.get('/resource')).rejects.toBeInstanceOf(ServiceError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('temporarily swaps rate limiter with withRateLimit and restores on cleanup', () => {
    const originalLimiter = createRateLimiterStub();
    const tempLimiter = createRateLimiterStub();

    originalLimiter.getStatus.mockReturnValue({ tokens: 1 });
    tempLimiter.getStatus.mockReturnValue({ tokens: 99 });
    originalLimiter.waitForPermission.mockResolvedValue(void 0);
    tempLimiter.waitForPermission.mockResolvedValue(void 0);

    getOrCreateMock
      .mockReturnValueOnce(originalLimiter)
      .mockReturnValueOnce(tempLimiter)
      .mockReturnValue(originalLimiter);

    const client = new HttpClient({
      baseUrl: 'https://api.example.com',
      providerName: 'example',
      rateLimit: { requestsPerSecond: 10 },
    });

    expect(client.getRateLimitStatus()).toEqual({ tokens: 1 });

    const restore = client.withRateLimit({ requestsPerSecond: 1 });
    const clientInternal = client as unknown as { rateLimiter: RateLimiterStub };
    expect(clientInternal.rateLimiter).toBe(tempLimiter);

    restore();
    expect(clientInternal.rateLimiter).toBe(originalLimiter);
    expect(client.getRateLimitStatus()).toEqual({ tokens: 1 });
  });
});
