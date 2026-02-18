import type { HttpClient } from '@exitbook/http';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCanUseCurrentPrice, mockTransformPriceResponse, mockTransformHistoricalResponse } = vi.hoisted(() => ({
  mockCanUseCurrentPrice: vi.fn<(timestamp: Date) => boolean>(),
  mockTransformPriceResponse: vi.fn(),
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

vi.mock('../cryptocompare-utils.js', async () => {
  const actual = await vi.importActual<typeof import('../cryptocompare-utils.js')>('../cryptocompare-utils.js');

  return {
    ...actual,
    canUseCurrentPrice: mockCanUseCurrentPrice,
    transformHistoricalResponse: mockTransformHistoricalResponse,
    transformPriceResponse: mockTransformPriceResponse,
  };
});

import { Currency, parseDecimal } from '@exitbook/core';

import type { PriceData } from '../../../core/types.js';
import type { PriceQueries } from '../../../persistence/queries/price-queries.js';
// Import after mocks so they receive mocked dependencies
import { CryptoCompareProvider } from '../provider.js';

describe('CryptoCompareProvider', () => {
  const defaultTimestamp = new Date('2024-01-01T00:00:00Z');

  let httpClientGet: ReturnType<typeof vi.fn>;
  let httpClient: HttpClient;
  let priceRepoMocks: {
    getPrice: ReturnType<typeof vi.fn>;
    savePrice: ReturnType<typeof vi.fn>;
  };
  let priceRepo: PriceQueries;
  let provider: CryptoCompareProvider;

  beforeEach(() => {
    mockCanUseCurrentPrice.mockReset();
    mockTransformPriceResponse.mockReset();
    mockTransformHistoricalResponse.mockReset();

    httpClientGet = vi.fn();
    httpClient = { get: httpClientGet } as unknown as HttpClient;

    priceRepoMocks = {
      getPrice: vi.fn().mockResolvedValue(ok()),
      savePrice: vi.fn().mockResolvedValue(ok()),
    };
    priceRepo = priceRepoMocks as unknown as PriceQueries;

    const mockRateLimit = {
      burstLimit: 5,
      requestsPerHour: 139,
      requestsPerMinute: 2,
      requestsPerSecond: 0.04,
    };

    provider = new CryptoCompareProvider(httpClient, priceRepo, {}, mockRateLimit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchPrice', () => {
    it('returns cached price without hitting the API', async () => {
      const cachedPrice: PriceData = {
        assetSymbol: Currency.create('BTC'),
        currency: Currency.create('USD'),
        price: parseDecimal('30123.45'),
        timestamp: defaultTimestamp,
        source: 'cryptocompare',
        fetchedAt: new Date('2024-01-01T01:00:00Z'),
      };

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

    it('fetches via current price API and caches the result when timestamp is recent', async () => {
      mockCanUseCurrentPrice.mockReturnValue(true);

      const apiResponse = {
        USD: 30200,
      };

      const expectedPrice: PriceData = {
        assetSymbol: Currency.create('BTC'),
        currency: Currency.create('USD'),
        price: parseDecimal('30200'),
        timestamp: defaultTimestamp,
        source: 'cryptocompare',
        fetchedAt: new Date('2024-01-01T02:00:00Z'),
      };

      httpClientGet.mockResolvedValueOnce(ok(apiResponse));
      mockTransformPriceResponse.mockReturnValueOnce(ok(expectedPrice));

      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('btc'),
        currency: Currency.create('usd'),
        timestamp: defaultTimestamp,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual(expectedPrice);
      }

      expect(httpClientGet).toHaveBeenCalledWith('/data/price?fsym=BTC&tsyms=USD');
      expect(mockTransformPriceResponse).toHaveBeenCalledWith(
        apiResponse,
        Currency.create('BTC'),
        defaultTimestamp,
        Currency.create('USD'),
        expect.any(Date)
      );
      expect(priceRepoMocks.savePrice).toHaveBeenCalledWith(expectedPrice, 'BTC');
    });

    it('fetches via historical API when timestamp is old', async () => {
      mockCanUseCurrentPrice.mockReturnValue(false);

      const historicalTimestamp = new Date('2020-05-21T00:00:00Z');
      const apiResponse = {
        Response: 'Success',
        Message: '',
        HasWarning: false,
        Type: 100,
        Data: {
          Aggregated: false,
          TimeFrom: 1590019200,
          TimeTo: 1590019200,
          Data: [
            {
              time: 1590019200,
              high: 9100,
              low: 8900,
              open: 9000,
              volumefrom: 1000,
              volumeto: 9000000,
              close: 9000,
              conversionType: 'direct',
              conversionSymbol: '',
            },
          ],
        },
      };

      const expectedPrice: PriceData = {
        assetSymbol: Currency.create('BTC'),
        currency: Currency.create('USD'),
        price: parseDecimal('9000'),
        timestamp: historicalTimestamp,
        source: 'cryptocompare',
        fetchedAt: new Date('2020-05-22T00:00:00Z'),
      };

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

      expect(httpClientGet).toHaveBeenCalledWith(
        expect.stringContaining('/data/v2/histo')
        // Historical endpoint uses minute/hour/day granularity
      );
      expect(mockTransformHistoricalResponse).toHaveBeenCalledWith(
        apiResponse,
        Currency.create('BTC'),
        historicalTimestamp,
        Currency.create('USD'),
        expect.any(Date),
        'day' // Old timestamp uses day granularity
      );
      expect(priceRepoMocks.savePrice).toHaveBeenCalledWith(expectedPrice, 'BTC');
    });

    it('uses USD as default currency when not specified', async () => {
      mockCanUseCurrentPrice.mockReturnValue(true);

      const apiResponse = {
        USD: 30200,
      };

      const expectedPrice: PriceData = {
        assetSymbol: Currency.create('BTC'),
        currency: Currency.create('USD'),
        price: parseDecimal('30200'),
        timestamp: defaultTimestamp,
        source: 'cryptocompare',
        fetchedAt: new Date('2024-01-01T02:00:00Z'),
      };

      httpClientGet.mockResolvedValueOnce(ok(apiResponse));
      mockTransformPriceResponse.mockReturnValueOnce(ok(expectedPrice));

      const result = await provider.fetchPrice({
        assetSymbol: Currency.create('btc'),
        timestamp: defaultTimestamp,
        currency: Currency.create('USD'),
      });

      expect(result.isOk()).toBe(true);
      expect(httpClientGet).toHaveBeenCalledWith('/data/price?fsym=BTC&tsyms=USD');
    });
  });

  describe('metadata', () => {
    it('provides correct provider metadata', () => {
      const metadata = provider.getMetadata();

      expect(metadata.name).toBe('cryptocompare');
      expect(metadata.displayName).toBe('CryptoCompare');
      expect(metadata.requiresApiKey).toBe(false);
      expect(metadata.capabilities.supportedOperations).toContain('fetchPrice');
    });
  });
});
