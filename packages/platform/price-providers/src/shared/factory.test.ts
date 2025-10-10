/**
 * Tests for shared factory (createPriceProviders)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPriceProviderByName, createPriceProviders, getAvailableProviderNames } from './factory.js';

// Mock CoinGecko provider creation
vi.mock('../coingecko/provider.js', () => ({
  createCoinGeckoProvider: vi.fn(() =>
    Promise.resolve({
      isErr: () => false,
      isOk: () => true,
      value: {
        getMetadata: () => ({
          capabilities: {
            supportedCurrencies: ['USD'],
            supportedOperations: ['fetchPrice', 'fetchBatch'],
          },
          displayName: 'CoinGecko',
          name: 'coingecko',
          priority: 1,
          requiresApiKey: false,
        }),
      },
    })
  ),
}));

vi.mock('@exitbook/shared-logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('createPriceProviders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create CoinGecko provider by default', async () => {
    const providers = await createPriceProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]?.getMetadata().name).toBe('coingecko');
  });

  it('should use environment variable for API key', async () => {
    process.env.COINGECKO_API_KEY = 'env-key';

    const { createCoinGeckoProvider } = await import('../coingecko/provider.js');
    await createPriceProviders();

    expect(createCoinGeckoProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'env-key',
      })
    );
  });

  it('should prefer config over env vars', async () => {
    process.env.COINGECKO_API_KEY = 'env-key';

    const { createCoinGeckoProvider } = await import('../coingecko/provider.js');
    await createPriceProviders({
      coingecko: { apiKey: 'config-key' },
    });

    expect(createCoinGeckoProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'config-key',
      })
    );
  });

  it('should respect enabled: false', async () => {
    const providers = await createPriceProviders({
      coingecko: { enabled: false },
    });

    expect(providers).toHaveLength(0);
  });
});

describe('createPriceProviderByName', () => {
  it('should create provider by name', async () => {
    const result = await createPriceProviderByName('coingecko');
    expect(result.isOk()).toBe(true);
  });

  it('should be case-insensitive', async () => {
    const result = await createPriceProviderByName('CoinGecko');
    expect(result.isOk()).toBe(true);
  });
});

describe('getAvailableProviderNames', () => {
  it('should return available providers', () => {
    const names = getAvailableProviderNames();
    expect(names).toContain('coingecko');
  });
});
