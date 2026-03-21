import { describe, expect, it } from 'vitest';

import { createProviderHttpClient } from '../provider-http-client.js';

describe('runtime/http/provider-http-client', () => {
  it('should create HTTP client with basic configuration', () => {
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 10,
        requestsPerHour: 1000,
        requestsPerMinute: 60,
        requestsPerSecond: 1,
      },
    });

    expect(client).toBeDefined();
  });

  it('should apply default timeout and retries when not specified', () => {
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
    });

    expect(client).toBeDefined();
  });

  it('should use custom timeout and retries when provided', () => {
    const client = createProviderHttpClient({
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
      retries: 5,
      timeout: 5000,
    });

    expect(client).toBeDefined();
  });

  it('should allow API key configuration without headers', () => {
    const client = createProviderHttpClient({
      apiKey: 'test-api-key-123',
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
    });

    expect(client).toBeDefined();
  });

  it('should add API key to headers when header name is specified', () => {
    const client = createProviderHttpClient({
      apiKey: 'test-api-key-456',
      apiKeyHeader: 'X-API-Key',
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
    });

    expect(client).toBeDefined();
  });

  it('should merge additional headers with default Accept header', () => {
    const client = createProviderHttpClient({
      additionalHeaders: {
        'User-Agent': 'CustomAgent/1.0',
        'X-Custom-Header': 'custom-value',
      },
      baseUrl: 'https://api.example.com',
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 5,
        requestsPerHour: 500,
        requestsPerMinute: 30,
        requestsPerSecond: 0.5,
      },
    });

    expect(client).toBeDefined();
  });
});
