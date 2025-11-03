import type { HttpClient } from '@exitbook/platform-http';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PriceRepository } from '../../persistence/repositories/price-repository.js';
import type { PriceData } from '../../shared/types/index.js';

const {
  mockSelectBinanceInterval,
  mockBuildBinanceSymbol,
  mockMapCurrencyToBinanceQuote,
  mockBuildBinanceKlinesParams,
  mockTransformBinanceKlineResponse,
  mockIsBinanceCoinNotFoundError,
} = vi.hoisted(() => ({
  mockSelectBinanceInterval: vi.fn<(timestamp: Date) => { granularity: 'minute' | 'hour' | 'day'; interval: string }>(),
  mockBuildBinanceSymbol: vi.fn<(asset: unknown, quote: string) => string>(),
  mockMapCurrencyToBinanceQuote: vi.fn<(currency: unknown) => string[]>(),
  mockBuildBinanceKlinesParams: vi.fn<(symbol: string, interval: string, timestamp: Date) => Record<string, string>>(),
  mockTransformBinanceKlineResponse: vi.fn(),
  mockIsBinanceCoinNotFoundError: vi.fn<(code: number) => boolean>(),
}));

vi.mock('@exitbook/shared-logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../binance-utils.js', async () => {
  const actual = await vi.importActual<typeof import('../binance-utils.js')>('../binance-utils.js');

  return {
    ...actual,
    selectBinanceInterval: mockSelectBinanceInterval,
    buildBinanceSymbol: mockBuildBinanceSymbol,
    mapCurrencyToBinanceQuote: mockMapCurrencyToBinanceQuote,
    buildBinanceKlinesParams: mockBuildBinanceKlinesParams,
    transformBinanceKlineResponse: mockTransformBinanceKlineResponse,
    isBinanceCoinNotFoundError: mockIsBinanceCoinNotFoundError,
  };
});

import { Currency } from '@exitbook/core';

import { createTestPriceData } from '../../__tests__/test-helpers.js';
import { CoinNotFoundError } from '../../shared/errors.js';
// Import after mocks so they receive mocked dependencies
import { BinanceProvider } from '../provider.ts';

describe('BinanceProvider', () => {
  const defaultTimestamp = new Date('2024-01-01T00:00:00Z');

  let httpClientGet: ReturnType<typeof vi.fn>;
  let httpClient: HttpClient;
  let priceRepoMocks: {
    getPrice: ReturnType<typeof vi.fn>;
    savePrice: ReturnType<typeof vi.fn>;
  };
  let priceRepo: PriceRepository;
  let provider: BinanceProvider;

  beforeEach(() => {
    mockSelectBinanceInterval.mockReset();
    mockBuildBinanceSymbol.mockReset();
    mockMapCurrencyToBinanceQuote.mockReset();
    mockBuildBinanceKlinesParams.mockReset();
    mockTransformBinanceKlineResponse.mockReset();
    mockIsBinanceCoinNotFoundError.mockReset();

    httpClientGet = vi.fn();
    httpClient = { get: httpClientGet } as unknown as HttpClient;

    priceRepoMocks = {
      getPrice: vi.fn().mockResolvedValue(ok()),
      savePrice: vi.fn().mockResolvedValue(ok()),
    };
    priceRepo = priceRepoMocks as unknown as PriceRepository;

    const mockRateLimit = {
      burstLimit: 50,
      requestsPerHour: 6000,
      requestsPerMinute: 1200,
      requestsPerSecond: 20,
    };

    provider = new BinanceProvider(httpClient, priceRepo, {}, mockRateLimit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cached price without hitting the API', async () => {
    const cachedPrice: PriceData = createTestPriceData({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      price: 43000,
      timestamp: defaultTimestamp,
      source: 'binance',
      fetchedAt: new Date('2024-01-01T01:00:00Z'),
      granularity: 'minute',
    });

    priceRepoMocks.getPrice.mockResolvedValueOnce(ok(cachedPrice));

    const result = await provider.fetchPrice({
      asset: Currency.create('btc'),
      currency: Currency.create('usdt'),
      timestamp: defaultTimestamp,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(cachedPrice);
    }
    expect(httpClientGet).not.toHaveBeenCalled();
    expect(priceRepoMocks.savePrice).not.toHaveBeenCalled();
  });

  it('fetches from API and caches the result when cache miss', async () => {
    const klineResponse = [
      [
        1704067200000, // Open time
        '43000.00', // Open
        '43100.00', // High
        '42900.00', // Low
        '43050.00', // Close
        '100.5', // Volume
        1704067259999, // Close time
        '4324500.00', // Quote asset volume
        500, // Number of trades
        '50.25', // Taker buy base asset volume
        '2162250.00', // Taker buy quote asset volume
        '0', // Unused
      ],
    ];

    const expectedPrice: PriceData = createTestPriceData({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      price: 43050,
      timestamp: defaultTimestamp,
      source: 'binance',
      fetchedAt: new Date(),
      granularity: 'minute',
    });

    mockSelectBinanceInterval.mockReturnValue({ interval: '1m', granularity: 'minute' });
    mockMapCurrencyToBinanceQuote.mockReturnValue(['USDT']);
    mockBuildBinanceSymbol.mockReturnValue('BTCUSDT');
    mockBuildBinanceKlinesParams.mockReturnValue({
      symbol: 'BTCUSDT',
      interval: '1m',
      startTime: '1704067200000',
      limit: '1',
    });
    mockTransformBinanceKlineResponse.mockReturnValue(ok(expectedPrice));

    httpClientGet.mockResolvedValueOnce(ok(klineResponse));

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: defaultTimestamp,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(expectedPrice);
    }

    expect(httpClientGet).toHaveBeenCalledOnce();
    expect(priceRepoMocks.savePrice).toHaveBeenCalledOnce();
  });

  it('tries multiple quote assets when first one fails with CoinNotFoundError', async () => {
    mockSelectBinanceInterval.mockReturnValue({ granularity: 'minute', interval: '1m' });
    mockMapCurrencyToBinanceQuote.mockReturnValue(['USDT', 'BUSD', 'USD']);
    mockBuildBinanceSymbol.mockImplementation((asset, quote) => `BTC${quote}`);
    mockBuildBinanceKlinesParams.mockReturnValue({
      interval: '1m',
      limit: '1',
      startTime: '1704067200000',
      symbol: 'BTCUSDT',
    });

    // First call returns true (coin not found), second returns false (success)
    mockIsBinanceCoinNotFoundError.mockReturnValueOnce(true).mockReturnValueOnce(false);

    // First attempt returns error (invalid symbol)
    const errorResponse = {
      code: -1121,
      msg: 'Invalid symbol.',
    };
    httpClientGet.mockResolvedValueOnce(ok(errorResponse));

    // Second attempt succeeds
    const klineResponse = [
      [
        1704067200000,
        '43000.00',
        '43100.00',
        '42900.00',
        '43050.00',
        '100.5',
        1704067259999,
        '4324500.00',
        500,
        '50.25',
        '2162250.00',
        '0',
      ],
    ];

    const expectedPrice: PriceData = createTestPriceData({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      fetchedAt: new Date(),
      granularity: 'minute',
      price: 43050,
      source: 'binance',
      timestamp: defaultTimestamp,
    });

    httpClientGet.mockResolvedValueOnce(ok(klineResponse));
    mockTransformBinanceKlineResponse.mockReturnValue(ok(expectedPrice));

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: defaultTimestamp,
    });

    expect(result.isOk()).toBe(true);
    expect(httpClientGet).toHaveBeenCalledTimes(2);
  });

  it('returns CoinNotFoundError when all quote assets fail', async () => {
    mockSelectBinanceInterval.mockReturnValue({ interval: '1m', granularity: 'minute' });
    mockMapCurrencyToBinanceQuote.mockReturnValue(['USDT', 'BUSD']);
    mockBuildBinanceSymbol.mockImplementation((asset, quote) => `BTC${quote}`);
    mockBuildBinanceKlinesParams.mockReturnValue({
      symbol: 'BTCUSDT',
      interval: '1m',
      startTime: '1704067200000',
      limit: '1',
    });
    mockIsBinanceCoinNotFoundError.mockReturnValue(true);

    // All attempts return invalid symbol error
    const errorResponse = {
      code: -1121,
      msg: 'Invalid symbol.',
    };

    httpClientGet.mockResolvedValue(ok(errorResponse));

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: defaultTimestamp,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(CoinNotFoundError);
    }
    expect(httpClientGet).toHaveBeenCalledTimes(2); // Tried both USDT and BUSD
  });

  it('returns error when API returns non-coin-not-found error', async () => {
    mockSelectBinanceInterval.mockReturnValue({ interval: '1m', granularity: 'minute' });
    mockMapCurrencyToBinanceQuote.mockReturnValue(['USDT']);
    mockBuildBinanceSymbol.mockReturnValue('BTCUSDT');
    mockBuildBinanceKlinesParams.mockReturnValue({
      symbol: 'BTCUSDT',
      interval: '1m',
      startTime: '1704067200000',
      limit: '1',
    });
    mockIsBinanceCoinNotFoundError.mockReturnValue(false);

    // API returns rate limit error
    const errorResponse = {
      code: -1003,
      msg: 'Too many requests.',
    };

    httpClientGet.mockResolvedValueOnce(ok(errorResponse));

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: defaultTimestamp,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Too many requests');
    }
    // Should fail immediately, not try other quote assets
    expect(httpClientGet).toHaveBeenCalledOnce();
  });

  it('returns error when API returns empty klines array', async () => {
    mockSelectBinanceInterval.mockReturnValue({ interval: '1m', granularity: 'minute' });
    mockMapCurrencyToBinanceQuote.mockReturnValue(['USDT']);
    mockBuildBinanceSymbol.mockReturnValue('BTCUSDT');
    mockBuildBinanceKlinesParams.mockReturnValue({
      symbol: 'BTCUSDT',
      interval: '1m',
      startTime: '1704067200000',
      limit: '1',
    });

    // Empty array - no data available
    httpClientGet.mockResolvedValueOnce(ok([]));

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: defaultTimestamp,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(CoinNotFoundError);
      expect(result.error.message).toContain('returned no data');
    }
  });

  it('returns error when kline transformation fails', async () => {
    const klineResponse = [
      [
        1704067200000,
        '43000.00',
        '43100.00',
        '42900.00',
        '43050.00',
        '100.5',
        1704067259999,
        '4324500.00',
        500,
        '50.25',
        '2162250.00',
        '0',
      ],
    ];

    mockSelectBinanceInterval.mockReturnValue({ granularity: 'minute', interval: '1m' });
    mockMapCurrencyToBinanceQuote.mockReturnValue(['USDT']);
    mockBuildBinanceSymbol.mockReturnValue('BTCUSDT');
    mockBuildBinanceKlinesParams.mockReturnValue({
      interval: '1m',
      limit: '1',
      startTime: '1704067200000',
      symbol: 'BTCUSDT',
    });

    // Transformation fails (e.g., invalid price)
    mockTransformBinanceKlineResponse.mockReturnValue(err(new Error('Invalid price in kline')));

    httpClientGet.mockResolvedValueOnce(ok(klineResponse));

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: defaultTimestamp,
    });

    expect(result.isErr()).toBe(true);
  });

  it('handles invalid API response format', async () => {
    mockSelectBinanceInterval.mockReturnValue({ interval: '1m', granularity: 'minute' });
    mockMapCurrencyToBinanceQuote.mockReturnValue(['USDT']);
    mockBuildBinanceSymbol.mockReturnValue('BTCUSDT');
    mockBuildBinanceKlinesParams.mockReturnValue({
      symbol: 'BTCUSDT',
      interval: '1m',
      startTime: '1704067200000',
      limit: '1',
    });

    // Invalid response format
    const invalidResponse = { invalid: 'format' };

    httpClientGet.mockResolvedValueOnce(ok(invalidResponse));

    const result = await provider.fetchPrice({
      asset: Currency.create('BTC'),
      currency: Currency.create('USDT'),
      timestamp: defaultTimestamp,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Invalid Binance klines response');
    }
  });

  it('has correct provider metadata', () => {
    const metadata = provider.getMetadata();

    expect(metadata.name).toBe('binance');
    expect(metadata.displayName).toBe('Binance');
    expect(metadata.requiresApiKey).toBe(false);
    expect(metadata.capabilities.supportedAssetTypes).toContain('crypto');
    expect(metadata.capabilities.supportedAssets).toBeUndefined();
    expect(metadata.capabilities.supportedOperations).toContain('fetchPrice');
    expect(metadata.capabilities.granularitySupport).toHaveLength(2);
    expect(metadata.capabilities.granularitySupport?.[0]?.granularity).toBe('minute');
    expect(metadata.capabilities.granularitySupport?.[1]?.granularity).toBe('day');
  });
});
