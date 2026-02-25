import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { HttpClient } from '../client.js';
import type { HttpEffects } from '../core/types.js';
import { InstrumentationCollector } from '../instrumentation.js';
import { HttpError, RateLimitError, ResponseValidationError } from '../types.js';

describe('HttpClient - Result Type Implementation', () => {
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
      expect(result.error).toBeInstanceOf(HttpError);
      expect(result.error.message).toContain('HTTP 500');
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

describe('HttpClient - Schema Validation', () => {
  it('should validate response with schema and return validated data on success', async () => {
    const responseData = { id: 123, name: 'test', active: true };
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve(responseData),
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

    const schema = z.object({
      id: z.number(),
      name: z.string(),
      active: z.boolean(),
    });

    const result = await client.get('/test', { schema });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(responseData);
    }
  });

  it('should return ResponseValidationError when schema validation fails', async () => {
    const invalidData = { id: '123', name: 'test', active: 'yes' }; // Wrong types
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve(invalidData),
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

    const schema = z.object({
      id: z.number(),
      name: z.string(),
      active: z.boolean(),
    });

    const result = await client.get('/test', { schema });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ResponseValidationError);
      expect(result.error.message).toContain('Response validation failed');

      const validationError = result.error as ResponseValidationError;
      expect(validationError.providerName).toBe('test-provider');
      expect(validationError.endpoint).toBe('/test');
      expect(validationError.validationIssues.length).toBeGreaterThan(0);
      expect(validationError.truncatedPayload).toContain('123');
    }

    // Verify error was logged
    const errorLogs = logSpy.mock.calls.filter((call) => call[0] === 'error');
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs[0]?.[1]).toContain('Response validation failed');
  });

  it('should limit logged validation issues to first 5 errors', async () => {
    const invalidData = {
      field1: 'wrong',
      field2: 'wrong',
      field3: 'wrong',
      field4: 'wrong',
      field5: 'wrong',
      field6: 'wrong',
      field7: 'wrong',
      field8: 'wrong',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve(invalidData),
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

    const schema = z.object({
      field1: z.number(),
      field2: z.number(),
      field3: z.number(),
      field4: z.number(),
      field5: z.number(),
      field6: z.number(),
      field7: z.number(),
      field8: z.number(),
    });

    const result = await client.get('/test', { schema });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const validationError = result.error as ResponseValidationError;

      // All issues should be stored
      expect(validationError.validationIssues.length).toBe(8);

      // But error message should only show first 5
      const semicolonCount = (validationError.message.match(/;/g) || []).length;
      expect(semicolonCount).toBeLessThanOrEqual(4); // 5 errors = 4 semicolons
    }

    // Verify log message mentions the count
    const errorLogs = logSpy.mock.calls.filter((call) => call[0] === 'error');
    expect(errorLogs[0]?.[1]).toContain('showing first 5 of 8 errors');
  });

  it('should truncate response payload in error to 500 characters', async () => {
    const largeData = { data: 'x'.repeat(1000) };
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve(largeData),
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

    const schema = z.object({
      data: z.number(), // Wrong type
    });

    const result = await client.get('/test', { schema });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const validationError = result.error as ResponseValidationError;
      expect(validationError.truncatedPayload.length).toBe(500);
    }
  });

  it('should validate POST response with schema', async () => {
    const responseData = { created: true, id: 42 };
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve(responseData),
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

    const schema = z.object({
      created: z.boolean(),
      id: z.number(),
    });

    const result = await client.post('/create', { name: 'test' }, { schema });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(responseData);
    }
  });

  it('should work without schema (backward compatibility)', async () => {
    const responseData = { anything: 'goes' };
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve(responseData),
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

    const result = await client.get('/test');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(responseData);
    }
  });
});

describe('HttpClient - Empty Response Handling', () => {
  it('should handle 204 No Content responses without calling json()', async () => {
    const jsonSpy = vi.fn();
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: jsonSpy,
      ok: true,
      status: 204,
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

    const result = await client.get('/delete');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeUndefined();
    }
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('should handle Content-Length: 0 responses without calling json()', async () => {
    const jsonSpy = vi.fn();
    const headers = new Headers();
    headers.set('content-length', '0');

    const mockFetch = vi.fn().mockResolvedValue({
      headers,
      json: jsonSpy,
      ok: true,
      status: 200,
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

    const result = await client.post('/update', {});

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeUndefined();
    }
    expect(jsonSpy).not.toHaveBeenCalled();
  });
});

describe('HttpClient - Rich Log Context', () => {
  it('should include method and providerName in validation error logs', async () => {
    const invalidData = { id: 'not-a-number' };
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve(invalidData),
      ok: true,
      status: 200,
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

    const schema = z.object({ id: z.number() });
    await client.get('/test', { schema });

    const errorLogs = logSpy.mock.calls.filter((call) => call[0] === 'error');
    expect(errorLogs.length).toBeGreaterThan(0);

    const metadata = errorLogs[0]?.[2] as Record<string, unknown> | undefined;
    expect(metadata).toBeDefined();
    expect(metadata).toMatchObject({
      method: 'GET',
      providerName: 'test-provider',
      status: 200,
    });
  });

  it('should include method and providerName in request failure logs', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));

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
        retries: 1,
      },
      mockEffects
    );

    await client.post('/test', { data: 'value' });

    const warnLogs = logSpy.mock.calls.filter((call) => call[0] === 'warn');
    expect(warnLogs.length).toBeGreaterThan(0);

    const metadata = warnLogs[0]?.[2] as Record<string, unknown> | undefined;
    expect(metadata).toBeDefined();
    expect(metadata).toMatchObject({
      method: 'POST',
      providerName: 'test-provider',
    });
  });
});

describe('HttpClient - Instrumentation', () => {
  it('should record metrics on successful request', async () => {
    const instrumentation = new InstrumentationCollector();
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ success: true }),
      ok: true,
      status: 200,
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: vi.fn(),
      // Mock now to return a sequence of values for start, rate limit checks, and end
      now: vi
        .fn()
        .mockReturnValueOnce(1000) // Rate limit check
        .mockReturnValueOnce(1000) // Logical request start time
        .mockReturnValueOnce(1000) // Attempt start time
        .mockReturnValueOnce(2000) // Duration calc (end)
        .mockReturnValueOnce(2000), // Timestamp (end)
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        service: 'blockchain', // Required for instrumentation
        rateLimit: { requestsPerSecond: 10 },
        instrumentation,
      },
      mockEffects
    );

    await client.get('/test');

    const metrics = instrumentation.getMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      provider: 'test-provider',
      service: 'blockchain',
      endpoint: '/test',
      method: 'GET',
      status: 200,
      durationMs: 1000,
      error: undefined,
    });
  });

  it('should record metrics on failed request', async () => {
    const instrumentation = new InstrumentationCollector();
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      ok: false,
      status: 500,
      text: () => Promise.resolve('Error'),
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockResolvedValue(undefined as unknown),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => 2000,
    };

    // Override now for start/end
    vi.spyOn(mockEffects, 'now')
      .mockReturnValueOnce(1000) // Rate limit
      .mockReturnValueOnce(1000) // Logical request start time
      .mockReturnValueOnce(1000) // Attempt start time
      .mockReturnValue(2000); // Duration/Timestamp

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        service: 'blockchain',
        rateLimit: { requestsPerSecond: 10 },
        retries: 1, // 1 attempt (fail fast)
        instrumentation,
      },
      mockEffects
    );

    await client.get('/test');

    const metrics = instrumentation.getMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      provider: 'test-provider',
      service: 'blockchain',
      endpoint: '/test',
      method: 'GET',
      status: 500,
      durationMs: 1000,
    });
  });

  it('should sanitize endpoints in metrics', async () => {
    const instrumentation = new InstrumentationCollector();
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ success: true }),
      ok: true,
      status: 200,
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn(),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => Date.now(),
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        service: 'exchange',
        rateLimit: { requestsPerSecond: 10 },
        instrumentation,
      },
      mockEffects
    );

    await client.get('/users/0x1234567890abcdef1234567890abcdef12345678/profile');

    const metrics = instrumentation.getMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.endpoint).toBe('/users/{address}/profile');
  });

  it('should not record metrics if service is not configured', async () => {
    const instrumentation = new InstrumentationCollector();
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ success: true }),
      ok: true,
      status: 200,
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn(),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => Date.now(),
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        // service missing
        rateLimit: { requestsPerSecond: 10 },
        instrumentation,
      },
      mockEffects
    );

    await client.get('/test');

    const metrics = instrumentation.getMetrics();
    expect(metrics).toHaveLength(0);
  });
});

describe('HttpClient - Concurrent Request Thread Safety', () => {
  it('should handle 100 concurrent requests without race conditions on rate limiter', async () => {
    let fetchCallCount = 0;
    let currentTime = 1000;
    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve({
        headers: new Headers(),
        json: () => Promise.resolve({ id: fetchCallCount }),
        ok: true,
        status: 200,
      });
    });

    const logSpy = vi.fn();
    const mockEffects: HttpEffects = {
      delay: vi.fn().mockImplementation((ms: number) => {
        currentTime += ms;
        return Promise.resolve();
      }),
      fetch: mockFetch,
      log: logSpy,
      now: () => currentTime,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: {
          requestsPerSecond: 5,
          burstLimit: 10,
        },
      },
      mockEffects
    );

    // Fire 100 concurrent requests
    const promises = Array.from({ length: 100 }, (_, i) => client.get(`/test/${i}`));

    const results = await Promise.all(promises);

    // All requests should succeed
    expect(results.every((r) => r.isOk())).toBe(true);
    expect(fetchCallCount).toBe(100);

    // Verify rate limiter was invoked (check for debug logs)
    const rateLimitLogs = logSpy.mock.calls.filter(
      (call) => call[0] === 'debug' && typeof call[1] === 'string' && call[1].includes('Rate limit enforced')
    );

    // With 100 concurrent requests and rate limit of 5/sec, we should see rate limiting
    expect(rateLimitLogs.length).toBeGreaterThan(0);
  });

  it('should process concurrent requests serially through rate limiter without duplicate timestamps', async () => {
    const timestamps: number[] = [];
    let currentTime = 1000;

    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ success: true }),
      ok: true,
      status: 200,
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockImplementation((ms: number) => {
        currentTime += ms;
        return Promise.resolve();
      }),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => {
        const timestamp = currentTime;
        timestamps.push(timestamp);
        currentTime += 10; // Increment by 10ms each call
        return timestamp;
      },
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        providerName: 'test-provider',
        rateLimit: {
          requestsPerSecond: 2,
          burstLimit: 5,
        },
      },
      mockEffects
    );

    // Fire 10 concurrent requests
    const promises = Array.from({ length: 10 }, () => client.get('/test'));
    await Promise.all(promises);

    // All timestamps should be unique (no race condition)
    const uniqueTimestamps = new Set(timestamps);
    expect(uniqueTimestamps.size).toBe(timestamps.length);
  });
});

describe('HttpClient - Hook Event Pairing', () => {
  it('should emit onRequestStart once per logical request across retries', async () => {
    const onRequestStart = vi.fn();
    const onRequestSuccess = vi.fn();
    const onBackoff = vi.fn();
    let attempt = 0;

    const mockFetch = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt <= 2) {
        // Throw generic error (not ServiceError) to trigger retry logic
        throw new Error('Network error');
      }
      return Promise.resolve({
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
        ok: true,
        status: 200,
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
        hooks: { onRequestStart, onRequestSuccess, onBackoff },
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
        retries: 3,
      },
      mockEffects
    );

    await client.get('/test');

    expect(onRequestStart).toHaveBeenCalledTimes(1); // ✅ Once per logical request
    expect(onRequestSuccess).toHaveBeenCalledTimes(1); // ✅ Once per logical request
    expect(onBackoff).toHaveBeenCalledTimes(2); // ✅ Two retry attempts
    expect(mockFetch).toHaveBeenCalledTimes(3); // Three physical attempts
  });

  it('should emit onRequestStart once for application-level rate limit retries', async () => {
    const onRequestStart = vi.fn();
    const onRequestSuccess = vi.fn();
    const onRequestFailure = vi.fn();
    let attempt = 0;

    // Simulate Etherscan-style rate limit detection
    const detectEtherscanRateLimit = (data: unknown): RateLimitError | void => {
      const response = data as { result?: string; status?: string };
      if (response.status === '0' && response.result?.includes('rate limit')) {
        return new RateLimitError('Rate limit detected', 1000);
      }
    };

    const mockFetch = vi.fn().mockImplementation(() => {
      attempt++;
      return Promise.resolve({
        headers: new Headers(),
        json: () =>
          Promise.resolve({
            status: attempt < 2 ? '0' : '1',
            result: attempt < 2 ? 'Max rate limit reached' : 'Success',
          }),
        ok: true,
        status: 200,
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
        hooks: { onRequestStart, onRequestSuccess, onRequestFailure },
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
        retries: 3,
      },
      mockEffects
    );

    const result = await client.get('/test', {
      validateResponse: detectEtherscanRateLimit,
    });

    expect(result.isOk()).toBe(true);
    expect(onRequestStart).toHaveBeenCalledTimes(1); // ✅ Once
    expect(onRequestSuccess).toHaveBeenCalledTimes(1); // ✅ Once
    expect(onRequestFailure).toHaveBeenCalledTimes(0); // ✅ Never (intermediate failures suppressed)
    expect(mockFetch).toHaveBeenCalledTimes(2); // Two attempts
  });

  it('should calculate durationMs including all retry attempts', async () => {
    const onRequestSuccess = vi.fn();
    let currentTime = 1000;
    let attempt = 0;

    const mockFetch = vi.fn().mockImplementation(() => {
      attempt++;
      currentTime += 100; // Each attempt takes 100ms
      if (attempt <= 2) {
        // Throw generic error (not ServiceError) to trigger retry logic
        throw new Error('Network error');
      }
      return Promise.resolve({
        headers: new Headers(),
        json: () => Promise.resolve({ success: true }),
        ok: true,
        status: 200,
      });
    });

    const mockEffects: HttpEffects = {
      delay: vi.fn().mockImplementation((ms: number) => {
        currentTime += ms;
        return Promise.resolve();
      }),
      fetch: mockFetch,
      log: vi.fn(),
      now: () => currentTime,
    };

    const client = new HttpClient(
      {
        baseUrl: 'https://api.example.com',
        hooks: { onRequestSuccess },
        providerName: 'test-provider',
        rateLimit: { requestsPerSecond: 10 },
        retries: 3,
      },
      mockEffects
    );

    await client.get('/test');

    expect(onRequestSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number) as unknown,
      })
    );

    const callArg = onRequestSuccess.mock.calls[0]?.[0] as { durationMs: number } | undefined;
    const duration = callArg?.durationMs;
    expect(duration).toBeGreaterThan(200); // Multiple attempts + backoff delays
  });
});

describe('HttpClient - buildRequest', () => {
  it('should call buildRequest on each retry attempt with fresh values', async () => {
    let attempt = 0;
    const buildRequest = vi.fn().mockImplementation(() => {
      attempt++;
      return {
        body: `nonce=${attempt}&data=test`,
        headers: {
          'API-Sign': `signature-${attempt}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      };
    });

    // First call: rate limit in body (triggers validateResponse), second call: success
    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = init.body as string;
      if (body.includes('nonce=1')) {
        // First attempt - return rate limit in body
        return Promise.resolve({
          headers: new Headers(),
          json: () => Promise.resolve({ error: ['EAPI:Rate limit exceeded'], result: {} }),
          ok: true,
          status: 200,
        });
      }
      // Second attempt - success with fresh nonce
      return Promise.resolve({
        headers: new Headers(),
        json: () => Promise.resolve({ error: [], result: { data: 'ok' } }),
        ok: true,
        status: 200,
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

    const result = await client.request('/test', {
      method: 'POST',
      buildRequest,
      validateResponse: (data) => {
        const resp = data as { error: string[] };
        if (resp.error?.some((e: string) => e.includes('Rate limit'))) {
          return new RateLimitError('Rate limit exceeded', 1000);
        }
      },
    });

    expect(result.isOk()).toBe(true);
    expect(buildRequest).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify first call used nonce=1
    const firstCall = mockFetch.mock.calls[0]!;
    expect((firstCall[1] as RequestInit).body).toBe('nonce=1&data=test');

    // Verify second call used fresh nonce=2
    const secondCall = mockFetch.mock.calls[1]!;
    expect((secondCall[1] as RequestInit).body).toBe('nonce=2&data=test');
  });

  it('should use static body/headers when buildRequest is not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      headers: new Headers(),
      json: () => Promise.resolve({ success: true }),
      ok: true,
      status: 200,
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

    const result = await client.request('/test', {
      method: 'POST',
      body: 'static-body',
      headers: { 'X-Custom': 'header' },
    });

    expect(result.isOk()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/test',
      expect.objectContaining({
        body: 'static-body',
        headers: expect.objectContaining({ 'X-Custom': 'header' }) as Record<string, string>,
      }) as RequestInit
    );
  });
});
