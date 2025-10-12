/**
 * Tests for shared factory (createPriceProviders)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPriceProviders, getAvailableProviderNames, createPriceProviderManager } from '../factory.ts';

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
          rateLimit: {
            burstLimit: 1,
            requestsPerHour: 600,
            requestsPerMinute: 10,
            requestsPerSecond: 0.17,
          },
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
          rateLimit: {
            burstLimit: 5,
            requestsPerHour: 139,
            requestsPerMinute: 2,
            requestsPerSecond: 0.04,
          },
        },
        displayName: 'CryptoCompare',
        name: 'cryptocompare',
        requiresApiKey: false,
      }),
    },
  })),
}));

// Mock Binance provider creation
vi.mock('../../binance/provider.js', () => ({
  createBinanceProvider: vi.fn(() => ({
    isErr: () => false,
    isOk: () => true,
    value: {
      getMetadata: () => ({
        capabilities: {
          supportedCurrencies: ['USD', 'USDT', 'BUSD'],
          supportedOperations: ['fetchPrice'],
          rateLimit: {
            burstLimit: 50,
            requestsPerHour: 6000,
            requestsPerMinute: 1200,
            requestsPerSecond: 20,
          },
        },
        displayName: 'Binance',
        name: 'binance',
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

  it('should create all providers by default', async () => {
    const result = await createPriceProviders();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const providers = result.value;
      // All providers (Binance, CoinGecko, CryptoCompare) are enabled by default
      expect(providers).toHaveLength(3);
      expect(providers[0]?.getMetadata().name).toBe('binance');
      expect(providers[1]?.getMetadata().name).toBe('coingecko');
      expect(providers[2]?.getMetadata().name).toBe('cryptocompare');
    }
  });

  it('should expose rate limits in provider metadata', async () => {
    const result = await createPriceProviders();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const providers = result.value;

      for (const provider of providers) {
        const metadata = provider.getMetadata();
        expect(metadata.capabilities.rateLimit).toBeDefined();
        expect(metadata.capabilities.rateLimit.burstLimit).toBeGreaterThan(0);
        expect(metadata.capabilities.rateLimit.requestsPerHour).toBeGreaterThan(0);
        expect(metadata.capabilities.rateLimit.requestsPerMinute).toBeGreaterThan(0);
        expect(metadata.capabilities.rateLimit.requestsPerSecond).toBeGreaterThan(0);
      }
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
      binance: { enabled: false },
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
      // CoinGecko is at index 1 (after Binance)
      const coinGeckoProvider = providers[1];

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
            rateLimit: {
              burstLimit: 1,
              requestsPerHour: 600,
              requestsPerMinute: 10,
              requestsPerSecond: 0.17,
            },
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
            rateLimit: {
              burstLimit: 1,
              requestsPerHour: 600,
              requestsPerMinute: 10,
              requestsPerSecond: 0.17,
            },
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
      // Binance and CryptoCompare should succeed (CoinGecko failed initialization)
      expect(providers).toHaveLength(2);
      expect(providers[0]?.getMetadata().name).toBe('binance');
      expect(providers[1]?.getMetadata().name).toBe('cryptocompare');
    }
  });
});

describe('getAvailableProviderNames', () => {
  it('should return available providers dynamically', () => {
    const names = getAvailableProviderNames();
    expect(names).toContain('binance');
    expect(names).toContain('coingecko');
    expect(names).toContain('cryptocompare');
    expect(names).toHaveLength(3);
  });
});

describe('createPriceProviderManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...process.env };
  });

  it('should create manager with providers registered', async () => {
    const result = await createPriceProviderManager();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const manager = result.value;
      expect(manager).toBeDefined();
      // Manager should have providers registered
      const health = manager.getProviderHealth();
      expect(health.size).toBeGreaterThan(0);
    }
  });

  it('should use default manager config when not provided', async () => {
    const result = await createPriceProviderManager({
      providers: {
        coingecko: { apiKey: 'test-key' },
      },
    });

    expect(result.isOk()).toBe(true);
    // Defaults: defaultCurrency='USD', maxConsecutiveFailures=5, cacheTtlSeconds=300
  });

  it('should override manager config when provided', async () => {
    const result = await createPriceProviderManager({
      manager: {
        defaultCurrency: 'EUR',
        cacheTtlSeconds: 600,
      },
    });

    expect(result.isOk()).toBe(true);
  });

  it('should pass provider config to createPriceProviders', async () => {
    const { createCoinGeckoProvider } = await import('../../coingecko/provider.ts');

    await createPriceProviderManager({
      providers: {
        coingecko: { apiKey: 'manager-key', useProApi: true },
      },
    });

    expect(createCoinGeckoProvider).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        apiKey: 'manager-key',
        useProApi: true,
      })
    );
  });

  it('should return error if provider creation fails', async () => {
    const result = await createPriceProviderManager({
      providers: {
        binance: { enabled: false },
        coingecko: { enabled: false },
        cryptocompare: { enabled: false },
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No price providers were successfully created');
    }
  });
});
