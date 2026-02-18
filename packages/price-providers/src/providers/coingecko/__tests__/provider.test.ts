import type { HttpClient } from '@exitbook/http';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCanUseSimplePrice, mockTransformSimplePriceResponse, mockTransformHistoricalResponse } = vi.hoisted(() => ({
  mockCanUseSimplePrice: vi.fn<(timestamp: Date) => boolean>(),
  mockTransformSimplePriceResponse: vi.fn(),
  mockTransformHistoricalResponse: vi.fn(),
}));

vi.mock('@exitbook/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../coingecko-utils.js', async () => {
  const actual = await vi.importActual<typeof import('../coingecko-utils.js')>('../coingecko-utils.js');

  return {
    ...actual,
    canUseSimplePrice: mockCanUseSimplePrice,
    transformHistoricalResponse: mockTransformHistoricalResponse,
    transformSimplePriceResponse: mockTransformSimplePriceResponse,
  };
});

import { Currency } from '@exitbook/core';

import { createTestPriceData } from '../../../__tests__/test-helpers.js';
import type { PriceData } from '../../../core/types.js';
import type { PriceQueries } from '../../../persistence/repositories/price-queries.js';
import type { ProviderQueries } from '../../../persistence/repositories/provider-queries.js';
// Import after mocks so they receive mocked dependencies
import { CoinGeckoProvider } from '../provider.js';

describe('CoinGeckoProvider', () => {
  const defaultTimestamp = new Date('2024-01-01T00:00:00Z');

  let httpClientGet: ReturnType<typeof vi.fn>;
  let httpClient: HttpClient;
  let providerRepoMocks: {
    getCoinIdForSymbol: ReturnType<typeof vi.fn>;
    needsCoinListSync: ReturnType<typeof vi.fn>;
    updateProviderSync: ReturnType<typeof vi.fn>;
    upsertCoinMappings: ReturnType<typeof vi.fn>;
    upsertProvider: ReturnType<typeof vi.fn>;
  };
  let providerRepo: ProviderQueries;
  let priceRepoMocks: {
    getPrice: ReturnType<typeof vi.fn>;
    savePrice: ReturnType<typeof vi.fn>;
  };
  let priceRepo: PriceQueries;
  let provider: CoinGeckoProvider;

  beforeEach(() => {
    mockCanUseSimplePrice.mockReset();
    mockTransformSimplePriceResponse.mockReset();
    mockTransformHistoricalResponse.mockReset();

    httpClientGet = vi.fn();
    httpClient = { get: httpClientGet } as unknown as HttpClient;

    providerRepoMocks = {
      getCoinIdForSymbol: vi.fn().mockResolvedValue(ok('bitcoin')),
      needsCoinListSync: vi.fn().mockResolvedValue(ok(true)),
      updateProviderSync: vi.fn().mockResolvedValue(ok()),
      upsertCoinMappings: vi.fn().mockResolvedValue(ok()),
      upsertProvider: vi.fn().mockResolvedValue(ok({ id: 1 } as const)),
    };
    providerRepo = providerRepoMocks as unknown as ProviderQueries;

    priceRepoMocks = {
      getPrice: vi.fn().mockResolvedValue(ok()),
      savePrice: vi.fn().mockResolvedValue(ok()),
    };
    priceRepo = priceRepoMocks as unknown as PriceQueries;

    const mockRateLimit = {
      burstLimit: 1,
      requestsPerHour: 600,
      requestsPerMinute: 10,
      requestsPerSecond: 0.17,
    };

    provider = new CoinGeckoProvider(httpClient, priceRepo, providerRepo, {}, mockRateLimit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cached price without hitting the API', async () => {
    const cachedPrice: PriceData = createTestPriceData({
      assetSymbol: Currency.create('BTC'),
      currency: Currency.create('USD'),
      price: 30123.45,
      timestamp: defaultTimestamp,
      source: 'coingecko',
      fetchedAt: new Date('2024-01-01T01:00:00Z'),
    });

    priceRepoMocks.getPrice.mockResolvedValueOnce(ok(cachedPrice));

    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('btc'),
      currency: Currency.create('usd'),
      timestamp: defaultTimestamp,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(cachedPrice);
    }
    expect(httpClientGet).not.toHaveBeenCalled();
    expect(priceRepoMocks.savePrice).not.toHaveBeenCalled();
  });

  it('fetches via simple price API and caches the result when data is recent', async () => {
    mockCanUseSimplePrice.mockReturnValue(true);

    const apiResponse = {
      bitcoin: {
        usd: 30200,
      },
    };

    const expectedPrice: PriceData = createTestPriceData({
      assetSymbol: Currency.create('BTC'),
      currency: Currency.create('USD'),
      price: 30200,
      timestamp: defaultTimestamp,
      source: 'coingecko',
      fetchedAt: new Date('2024-01-01T02:00:00Z'),
    });

    httpClientGet.mockResolvedValueOnce(ok(apiResponse));
    mockTransformSimplePriceResponse.mockReturnValueOnce(ok(expectedPrice));

    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('btc'),
      currency: Currency.create('usd'),
      timestamp: defaultTimestamp,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(expectedPrice);
    }

    expect(httpClientGet).toHaveBeenCalledWith('/simple/price?ids=bitcoin&vs_currencies=usd', {
      headers: {
        'x-cg-demo-api-key': '',
      },
    });
    expect(mockTransformSimplePriceResponse).toHaveBeenCalledWith(
      apiResponse,
      'bitcoin',
      Currency.create('BTC'),
      defaultTimestamp,
      Currency.create('USD'),
      expect.any(Date)
    );
    expect(priceRepoMocks.savePrice).toHaveBeenCalledWith(expectedPrice, 'bitcoin');
  });

  it('fetches via historical API when timestamp is old', async () => {
    mockCanUseSimplePrice.mockReturnValue(false);

    const historicalTimestamp = new Date('2020-05-21T00:00:00Z');
    const apiResponse = {
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      market_data: {
        current_price: {
          usd: 9000,
        },
      },
    };

    const expectedPrice: PriceData = createTestPriceData({
      assetSymbol: Currency.create('BTC'),
      currency: Currency.create('USD'),
      price: 9000,
      timestamp: historicalTimestamp,
      source: 'coingecko',
      fetchedAt: new Date('2020-05-22T00:00:00Z'),
    });

    httpClientGet.mockResolvedValueOnce(ok(apiResponse));
    mockTransformHistoricalResponse.mockReturnValueOnce(ok(expectedPrice));

    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('btc'),
      currency: Currency.create('usd'),
      timestamp: historicalTimestamp,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(expectedPrice);
    }

    expect(httpClientGet).toHaveBeenCalledWith('/coins/bitcoin/history?date=21-05-2020&localization=false', {
      headers: {
        'x-cg-demo-api-key': '',
      },
    });
    expect(mockTransformHistoricalResponse).toHaveBeenCalledWith(
      apiResponse,
      Currency.create('BTC'),
      historicalTimestamp,
      Currency.create('USD'),
      expect.any(Date)
    );
    expect(priceRepoMocks.savePrice).toHaveBeenCalledWith(expectedPrice, 'bitcoin');
  });

  it('returns an error when no coin mapping exists for the asset', async () => {
    priceRepoMocks.getPrice.mockResolvedValueOnce(ok());
    providerRepoMocks.getCoinIdForSymbol.mockResolvedValueOnce(ok());
    mockCanUseSimplePrice.mockReturnValue(true);

    const result = await provider.fetchPrice({
      assetSymbol: Currency.create('unknown'),
      currency: Currency.create('usd'),
      timestamp: defaultTimestamp,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('No CoinGecko coin ID found for symbol: UNKNOWN');
    }
    expect(httpClientGet).not.toHaveBeenCalled();
  });
});
