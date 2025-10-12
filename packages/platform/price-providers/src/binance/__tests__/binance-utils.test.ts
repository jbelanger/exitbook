/**
 * Tests for Binance utility functions
 *
 * Pure function tests - no mocks needed
 */

import { Currency } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import {
  buildBinanceKlinesParams,
  buildBinanceSymbol,
  extractClosePriceFromKline,
  isBinanceCoinNotFoundError,
  isBinanceRateLimitError,
  mapCurrencyToBinanceQuote,
  selectBinanceInterval,
  transformBinanceKlineResponse,
} from '../binance-utils.js';
import type { BinanceKline } from '../schemas.js';

describe('mapCurrencyToBinanceQuote', () => {
  it('maps USD to USDT, BUSD, USD', () => {
    const currency = Currency.create('USD');
    const result = mapCurrencyToBinanceQuote(currency);

    expect(result).toEqual(['USDT', 'BUSD', 'USD']);
  });

  it('maps EUR to EUR', () => {
    const currency = Currency.create('EUR');
    const result = mapCurrencyToBinanceQuote(currency);

    expect(result).toEqual(['EUR']);
  });

  it('maps GBP to GBP', () => {
    const currency = Currency.create('GBP');
    const result = mapCurrencyToBinanceQuote(currency);

    expect(result).toEqual(['GBP']);
  });

  it('maps other currencies as-is', () => {
    const currency = Currency.create('JPY');
    const result = mapCurrencyToBinanceQuote(currency);

    expect(result).toEqual(['JPY']);
  });
});

describe('buildBinanceSymbol', () => {
  it('builds BTCUSDT symbol', () => {
    const asset = Currency.create('BTC');
    const result = buildBinanceSymbol(asset, 'USDT');

    expect(result).toBe('BTCUSDT');
  });

  it('builds ETHBUSD symbol', () => {
    const asset = Currency.create('ETH');
    const result = buildBinanceSymbol(asset, 'BUSD');

    expect(result).toBe('ETHBUSD');
  });

  it('builds symbol with lowercase asset', () => {
    const asset = Currency.create('sol');
    const result = buildBinanceSymbol(asset, 'USDT');

    expect(result).toBe('SOLUSDT');
  });
});

describe('selectBinanceInterval', () => {
  it('returns 1m interval for timestamps within 365 days', () => {
    const now = new Date();
    const timestamp = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000); // 180 days ago

    const result = selectBinanceInterval(timestamp);

    expect(result).toEqual({
      granularity: 'minute',
      interval: '1m',
    });
  });

  it('returns 1m interval for exactly 365 days ago', () => {
    const now = new Date();
    const timestamp = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const result = selectBinanceInterval(timestamp);

    expect(result).toEqual({
      granularity: 'minute',
      interval: '1m',
    });
  });

  it('returns 1d interval for timestamps older than 365 days', () => {
    const now = new Date();
    const timestamp = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000); // 400 days ago

    const result = selectBinanceInterval(timestamp);

    expect(result).toEqual({
      granularity: 'day',
      interval: '1d',
    });
  });

  it('returns 1m interval for very recent timestamps', () => {
    const now = new Date();
    const timestamp = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

    const result = selectBinanceInterval(timestamp);

    expect(result).toEqual({
      granularity: 'minute',
      interval: '1m',
    });
  });
});

describe('extractClosePriceFromKline', () => {
  it('extracts close price from kline', () => {
    const kline: BinanceKline = [
      1499040000000, // Open time
      '0.01634000', // Open
      '0.80000000', // High
      '0.01575800', // Low
      '0.01577100', // Close
      '148976.11427815', // Volume
      1499644799999, // Close time
      '2434.19055334', // Quote asset volume
      308, // Number of trades
      '1756.87402397', // Taker buy base asset volume
      '28.46694368', // Taker buy quote asset volume
      '0', // Unused
    ];

    const result = extractClosePriceFromKline(kline);

    expect(result).toBe(0.015771);
  });

  it('extracts integer close price', () => {
    const kline: BinanceKline = [
      1633046400000, // Open time
      '47000.00', // Open
      '48000.00', // High
      '46500.00', // Low
      '47500.00', // Close
      '100.00', // Volume
      1633046459999, // Close time
      '4750000.00', // Quote asset volume
      1000, // Number of trades
      '50.00', // Taker buy base asset volume
      '2375000.00', // Taker buy quote asset volume
      '0', // Unused
    ];

    const result = extractClosePriceFromKline(kline);

    expect(result).toBe(47500);
  });

  it('handles very small prices', () => {
    const kline: BinanceKline = [
      1633046400000, // Open time
      '0.0000001', // Open
      '0.0000002', // High
      '0.00000005', // Low
      '0.00000015', // Close
      '1000000.00', // Volume
      1633046459999, // Close time
      '150.00', // Quote asset volume
      500, // Number of trades
      '500000.00', // Taker buy base asset volume
      '75.00', // Taker buy quote asset volume
      '0', // Unused
    ];

    const result = extractClosePriceFromKline(kline);

    expect(result).toBe(0.00000015);
  });
});

describe('transformBinanceKlineResponse', () => {
  it('transforms kline to PriceData', () => {
    const kline: BinanceKline = [
      1633046400000, // Open time
      '47000.00', // Open
      '48000.00', // High
      '46500.00', // Low
      '47500.00', // Close
      '100.00', // Volume
      1633046459999, // Close time
      '4750000.00', // Quote asset volume
      1000, // Number of trades
      '50.00', // Taker buy base asset volume
      '2375000.00', // Taker buy quote asset volume
      '0', // Unused
    ];

    const asset = Currency.create('BTC');
    const timestamp = new Date('2024-01-01T12:34:56Z');
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T13:00:00Z');

    const result = transformBinanceKlineResponse(kline, asset, timestamp, currency, fetchedAt, 'minute');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        asset,
        timestamp: new Date('2024-01-01T12:34:00Z'), // Rounded to minute
        price: 47500,
        currency,
        source: 'binance',
        fetchedAt,
        granularity: 'minute',
      });
    }
  });

  it('transforms kline with day granularity', () => {
    const kline: BinanceKline = [
      1633046400000, // Open time
      '3500.00', // Open
      '3600.00', // High
      '3400.00', // Low
      '3550.00', // Close
      '1000.00', // Volume
      1633046459999, // Close time
      '3550000.00', // Quote asset volume
      5000, // Number of trades
      '500.00', // Taker buy base asset volume
      '1775000.00', // Taker buy quote asset volume
      '0', // Unused
    ];

    const asset = Currency.create('ETH');
    const timestamp = new Date('2024-01-15T12:34:56Z');
    const currency = Currency.create('EUR');
    const fetchedAt = new Date('2024-01-15T13:00:00Z');

    const result = transformBinanceKlineResponse(kline, asset, timestamp, currency, fetchedAt, 'day');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        asset,
        timestamp: new Date('2024-01-15T00:00:00Z'), // Rounded to day
        price: 3550,
        currency,
        source: 'binance',
        fetchedAt,
        granularity: 'day',
      });
    }
  });

  it('returns error for zero price', () => {
    const kline: BinanceKline = [
      1633046400000, // Open time
      '0.00', // Open
      '0.00', // High
      '0.00', // Low
      '0.00', // Close
      '0.00', // Volume
      1633046459999, // Close time
      '0.00', // Quote asset volume
      0, // Number of trades
      '0.00', // Taker buy base asset volume
      '0.00', // Taker buy quote asset volume
      '0', // Unused
    ];

    const asset = Currency.create('BTC');
    const timestamp = new Date('2024-01-01T12:00:00Z');
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T13:00:00Z');

    const result = transformBinanceKlineResponse(kline, asset, timestamp, currency, fetchedAt, 'minute');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Binance price for BTC');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });

  it('returns error for negative price', () => {
    const kline: BinanceKline = [
      1633046400000, // Open time
      '47000.00', // Open
      '48000.00', // High
      '46500.00', // Low
      '-100.00', // Close (invalid)
      '100.00', // Volume
      1633046459999, // Close time
      '4750000.00', // Quote asset volume
      1000, // Number of trades
      '50.00', // Taker buy base asset volume
      '2375000.00', // Taker buy quote asset volume
      '0', // Unused
    ];

    const asset = Currency.create('BTC');
    const timestamp = new Date('2024-01-01T12:00:00Z');
    const currency = Currency.create('USD');
    const fetchedAt = new Date('2024-01-01T13:00:00Z');

    const result = transformBinanceKlineResponse(kline, asset, timestamp, currency, fetchedAt, 'minute');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('Binance price for BTC');
      expect(result.error.message).toContain('invalid');
      expect(result.error.message).toContain('must be positive');
    }
  });
});

describe('buildBinanceKlinesParams', () => {
  it('builds klines params with 1m interval', () => {
    const timestamp = new Date('2024-01-01T12:30:00Z');
    const params = buildBinanceKlinesParams('BTCUSDT', '1m', timestamp);

    expect(params).toEqual({
      symbol: 'BTCUSDT',
      interval: '1m',
      startTime: timestamp.getTime().toString(),
      limit: '1',
    });
  });

  it('builds klines params with 1d interval', () => {
    const timestamp = new Date('2023-01-15T00:00:00Z');
    const params = buildBinanceKlinesParams('ETHBUSD', '1d', timestamp);

    expect(params).toEqual({
      symbol: 'ETHBUSD',
      interval: '1d',
      startTime: timestamp.getTime().toString(),
      limit: '1',
    });
  });

  it('correctly converts timestamp to milliseconds', () => {
    const timestamp = new Date(1704110400000); // 2024-01-01T12:00:00Z
    const params = buildBinanceKlinesParams('SOLUSDT', '1m', timestamp);

    expect(params.startTime).toBe('1704110400000');
  });
});

describe('isBinanceCoinNotFoundError', () => {
  it('returns true for error code -1121', () => {
    expect(isBinanceCoinNotFoundError(-1121)).toBe(true);
  });

  it('returns false for other error codes', () => {
    expect(isBinanceCoinNotFoundError(-1100)).toBe(false);
    expect(isBinanceCoinNotFoundError(-1003)).toBe(false);
    expect(isBinanceCoinNotFoundError(429)).toBe(false);
    expect(isBinanceCoinNotFoundError(0)).toBe(false);
  });
});

describe('isBinanceRateLimitError', () => {
  it('returns true for error code -1003', () => {
    expect(isBinanceRateLimitError(-1003)).toBe(true);
  });

  it('returns false for other error codes', () => {
    expect(isBinanceRateLimitError(-1121)).toBe(false);
    expect(isBinanceRateLimitError(-1100)).toBe(false);
    expect(isBinanceRateLimitError(429)).toBe(false);
    expect(isBinanceRateLimitError(0)).toBe(false);
  });
});
