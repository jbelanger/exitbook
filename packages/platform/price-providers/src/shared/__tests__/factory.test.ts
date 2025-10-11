/**
 * Tests for shared factory (createPriceProviders)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPriceProviders, getAvailableProviderNames } from '../factory.ts';

// Mock database initialization
vi.mock('../../pricing/database.js', () => ({
  createPricesDatabase: vi.fn(() => ({
    isErr: () => false,
    isOk: () => true,
    value: {} as unknown, // Mock database instance
  })),
  initializePricesDatabase: vi.fn(() =>
    Promise.resolve({
      isErr: () => false,
      isOk: () => true,
    })
  ),
}));

// Mock CoinGecko provider creation
vi.mock('../../coingecko/provider.js', () => ({
  createCoinGeckoProvider: vi.fn(() => ({
    isErr: () => false,
    isOk: () => true,
    value: {
      getMetadata: () => ({
        capabilities: {
          supportedCurrencies: ['USD'],
          supportedOperations: ['fetchPrice'],
        },
        displayName: 'CoinGecko',
        name: 'coingecko',
        requiresApiKey: false,
      }),
      initialize: vi.fn(() =>
        Promise.resolve({
          isErr: () => false,
          isOk: () => true,
          value: undefined,
        })
      ),
    },
  })),
}));

// Mock CryptoCompare provider creation
vi.mock('../../cryptocompare/provider.js', () => ({
  createCryptoCompareProvider: vi.fn(() => ({
    isErr: () => false,
    isOk: () => true,
    value: {
      getMetadata: () => ({
        capabilities: {
          supportedCurrencies: ['USD'],
          supportedOperations: ['fetchPrice'],
        },
        displayName: 'CryptoCompare',
        name: 'cryptocompare',
        requiresApiKey: false,
      }),
    },
  })),
}));

vi.mock('@exitbook/shared-logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
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

  it('should create both providers by default', async () => {
    const result = await createPriceProviders();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const providers = result.value;
      // Both CoinGecko and CryptoCompare are enabled by default
      expect(providers).toHaveLength(2);
      expect(providers[0]?.getMetadata().name).toBe('coingecko');
      expect(providers[1]?.getMetadata().name).toBe('cryptocompare');
    }
  });

  it('should pass empty config when no config provided', async () => {
    const { createCoinGeckoProvider } = await import('../../coingecko/provider.ts');
    await createPriceProviders();

    // Factory passes empty config, individual providers read from process.env
    expect(createCoinGeckoProvider).toHaveBeenCalledWith(
      expect.anything(), // db parameter
      {} // Empty config - provider reads process.env itself
    );
  });

  it('should prefer config over env vars', async () => {
    process.env.COINGECKO_API_KEY = 'env-key';

    const { createCoinGeckoProvider } = await import('../../coingecko/provider.ts');
    await createPriceProviders({
      coingecko: { apiKey: 'config-key' },
    });

    expect(createCoinGeckoProvider).toHaveBeenCalledWith(
      expect.anything(), // db parameter
      expect.objectContaining({
        apiKey: 'config-key',
      })
    );
  });

  it('should respect enabled: false', async () => {
    const result = await createPriceProviders({
      coingecko: { enabled: false },
      cryptocompare: { enabled: false },
    });

    // Should return error when no providers are enabled
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No price providers were successfully created');
    }
  });

  it('should call initialize() hook if provider implements it', async () => {
    const result = await createPriceProviders();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const providers = result.value;
      const coinGeckoProvider = providers[0];

      // CoinGecko provider has initialize() hook
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Extracting method for vitest mock assertion
      const initializeMethod = coinGeckoProvider?.initialize;
      expect(initializeMethod).toBeDefined();
      expect(initializeMethod).toHaveBeenCalled();
    }
  });

  it('should skip provider if initialization fails', async () => {
    // Mock CoinGecko to fail initialization
    const { createCoinGeckoProvider } = await import('../../coingecko/provider.ts');
    const { ok, err } = await import('neverthrow');
    // Provide all required properties for CoinGeckoProvider mock
    vi.mocked(createCoinGeckoProvider).mockReturnValueOnce(
      ok({
        metadata: {
          capabilities: {
            supportedCurrencies: ['USD'],
            supportedOperations: ['fetchPrice'],
          },
          displayName: 'CoinGecko',
          name: 'coingecko',
          requiresApiKey: false,
        },
        logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
        httpClient: {},
        providerRepo: {},
        getMetadata: () => ({
          capabilities: {
            supportedCurrencies: ['USD'],
            supportedOperations: ['fetchPrice'],
          },
          displayName: 'CoinGecko',
          name: 'coingecko',
          requiresApiKey: false,
        }),
        initialize: vi.fn(() => Promise.resolve(err(new Error('Init failed')))),
        fetchPrice: vi.fn(),
        fetchHistoricalPrice: vi.fn(),
        close: vi.fn(),
      } as unknown as import('../../coingecko/provider.ts').CoinGeckoProvider)
    );

    const result = await createPriceProviders();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const providers = result.value;
      // Only CryptoCompare should succeed
      expect(providers).toHaveLength(1);
      expect(providers[0]?.getMetadata().name).toBe('cryptocompare');
    }
  });
});

describe('getAvailableProviderNames', () => {
  it('should return available providers dynamically', () => {
    const names = getAvailableProviderNames();
    expect(names).toContain('coingecko');
    expect(names).toContain('cryptocompare');
    expect(names).toHaveLength(2);
  });
});
