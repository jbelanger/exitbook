import type { HttpClient } from '@exitbook/http';
import { describe, expect, it, vi } from 'vitest';

import type { PricesDB } from '../../../price-cache/persistence/database.js';
import type { PriceQueries } from '../../../price-cache/persistence/queries.js';

const { mockCreatePriceQueries, mockCreateProviderHttpClient } = vi.hoisted(() => ({
  mockCreatePriceQueries: vi.fn(),
  mockCreateProviderHttpClient: vi.fn(),
}));

vi.mock('../../../price-cache/persistence/queries.js', () => ({
  createPriceQueries: mockCreatePriceQueries,
}));

vi.mock('../../../runtime/http/provider-http-client.js', () => ({
  createProviderHttpClient: mockCreateProviderHttpClient,
}));

import { buildPriceProvider } from '../provider-construction.js';

describe('buildPriceProvider', () => {
  it('builds shared dependencies once and passes through additional provider deps', () => {
    const db = {} as PricesDB;
    const httpClient = { get: vi.fn() } as unknown as HttpClient;
    const priceQueries = {
      getPrice: vi.fn(),
      savePrice: vi.fn(),
    } as unknown as PriceQueries;
    const provider = { name: 'test-provider' };

    mockCreateProviderHttpClient.mockReturnValue(httpClient);
    mockCreatePriceQueries.mockReturnValue(priceQueries);

    const result = buildPriceProvider({
      buildAdditionalDeps: (inputDb) => {
        expect(inputDb).toBe(db);
        return {
          providerRepo: { getOrCreateProvider: vi.fn() },
        };
      },
      buildProvider: (deps) => {
        expect(deps.httpClient).toBe(httpClient);
        expect(deps.priceQueries).toBe(priceQueries);
        expect(deps.providerRepo).toBeDefined();
        return provider;
      },
      creationError: 'Failed to create test provider',
      db,
      http: {
        apiKey: 'demo-key',
        apiKeyHeader: 'x-demo-key',
        baseUrl: 'https://example.com',
        providerName: 'TestProvider',
        rateLimit: {
          burstLimit: 1,
          requestsPerHour: 60,
          requestsPerMinute: 1,
          requestsPerSecond: 0.02,
        },
      },
    });

    expect(mockCreateProviderHttpClient).toHaveBeenCalledWith({
      apiKey: 'demo-key',
      apiKeyHeader: 'x-demo-key',
      baseUrl: 'https://example.com',
      instrumentation: undefined,
      providerName: 'TestProvider',
      rateLimit: {
        burstLimit: 1,
        requestsPerHour: 60,
        requestsPerMinute: 1,
        requestsPerSecond: 0.02,
      },
    });
    expect(mockCreatePriceQueries).toHaveBeenCalledWith(db);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(provider);
    }
  });

  it('wraps constructor failures with the provider-specific creation error', () => {
    mockCreateProviderHttpClient.mockImplementation(() => {
      throw new Error('boom');
    });

    const result = buildPriceProvider({
      buildProvider: () => ({ name: 'never-built' }),
      creationError: 'Failed to create test provider',
      db: {} as PricesDB,
      http: {
        baseUrl: 'https://example.com',
        providerName: 'TestProvider',
        rateLimit: {
          burstLimit: 1,
          requestsPerHour: 60,
          requestsPerMinute: 1,
          requestsPerSecond: 0.02,
        },
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Failed to create test provider');
    }
  });
});
