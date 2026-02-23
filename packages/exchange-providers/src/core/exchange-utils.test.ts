import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { processCCXTBalance, validateCredentials, validateRawData } from './exchange-utils.js';

describe('validateCredentials', () => {
  const TestCredentialsSchema = z.object({
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
  });

  it('should succeed with valid credentials', () => {
    const credentials = { apiKey: 'test-key', apiSecret: 'test-secret' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(credentials);
    }
  });

  it('should fail with missing apiKey', () => {
    const credentials = { apiSecret: 'test-secret' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid kraken credentials');
  });

  it('should fail with missing secret', () => {
    const credentials = { apiKey: 'test-key' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid kraken credentials');
  });

  it('should fail with empty apiKey', () => {
    const credentials = { apiKey: '', apiSecret: 'test-secret' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid kraken credentials');
  });

  it('should fail with empty secret', () => {
    const credentials = { apiKey: 'test-key', apiSecret: '' };

    const result = validateCredentials(TestCredentialsSchema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid kraken credentials');
  });

  it('should fail with extra unexpected fields', () => {
    const schema = z
      .object({
        apiKey: z.string(),
      })
      .strict();

    const credentials = { apiKey: 'test-key', unexpectedField: 'value' };

    const result = validateCredentials(schema, credentials, 'kraken');

    expect(result.isErr()).toBe(true);
  });

  it('should succeed with optional fields', () => {
    const schema = z.object({
      apiKey: z.string(),
      apiSecret: z.string(),
      apiPassphrase: z.string().optional(),
    });

    const credentials = { apiKey: 'test-key', apiSecret: 'test-secret', apiPassphrase: 'test-pass' };

    const result = validateCredentials(schema, credentials, 'kucoin');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(credentials);
    }
  });

  it('should succeed with optional fields omitted', () => {
    const schema = z.object({
      apiKey: z.string(),
      apiSecret: z.string(),
      apiPassphrase: z.string().optional(),
    });

    const credentials = { apiKey: 'test-key', apiSecret: 'test-secret' };

    const result = validateCredentials(schema, credentials, 'kucoin');

    expect(result.isOk()).toBe(true);
  });

  it('should include exchange name in error message', () => {
    const credentials = {};

    const result = validateCredentials(TestCredentialsSchema, credentials, 'binance');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid binance credentials');
  });

  it('should handle null credentials', () => {
    const result = validateCredentials(TestCredentialsSchema, undefined, 'kraken');

    expect(result.isErr()).toBe(true);
  });

  it('should handle undefined credentials', () => {
    const result = validateCredentials(TestCredentialsSchema, undefined, 'kraken');

    expect(result.isErr()).toBe(true);
  });
});

describe('validateRawData', () => {
  const TestDataSchema = z.object({
    id: z.string(),
    amount: z.string(),
    timestamp: z.number(),
  });

  it('should succeed with valid data', () => {
    const rawData = { id: 'tx-1', amount: '100', timestamp: 1704067200000 };

    const result = validateRawData(TestDataSchema, rawData, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual(rawData);
    }
  });

  it('should fail with missing required field', () => {
    const rawData = { id: 'tx-1', amount: '100' };

    const result = validateRawData(TestDataSchema, rawData, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('timestamp');
  });

  it('should fail with wrong type', () => {
    const rawData = { id: 'tx-1', amount: 100, timestamp: 1704067200000 }; // amount should be string

    const result = validateRawData(TestDataSchema, rawData, 'kraken');

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('amount');
  });

  it('should succeed with exact schema match', () => {
    const rawData = { id: 'tx-1', amount: '100', timestamp: 1704067200000 };

    const result = validateRawData(TestDataSchema, rawData, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.id).toBe('tx-1');
      expect(result.value.amount).toBe('100');
      expect(result.value.timestamp).toBe(1704067200000);
    }
  });

  it('should handle array data', () => {
    const schema = z.array(z.object({ id: z.string() }));
    const rawData = [{ id: 'tx-1' }, { id: 'tx-2' }];

    const result = validateRawData(schema, rawData, 'kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(2);
    }
  });

  it('should include validation errors', () => {
    const rawData = { invalid: 'data' };

    const result = validateRawData(TestDataSchema, rawData, 'binance');

    expect(result.isErr()).toBe(true);
    // Should contain field names from validation errors
    expect(result._unsafeUnwrapErr().message).toContain('id');
  });
});

describe('processCCXTBalance', () => {
  it('should process balance with multiple currencies', () => {
    const ccxtBalance = {
      BTC: { total: 1.5, free: 1.0, used: 0.5 },
      ETH: { total: 10.0, free: 8.0, used: 2.0 },
      USD: { total: 5000, free: 5000, used: 0 },
      info: {
        /* exchange specific data */
      },
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result).toEqual({
      BTC: '1.5',
      ETH: '10',
      USD: '5000',
    });
  });

  it('should skip CCXT metadata fields', () => {
    const ccxtBalance = {
      BTC: { total: 1.0 },
      info: { should: 'be skipped' },
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result).not.toHaveProperty('info');
    expect(result).not.toHaveProperty('timestamp');
    expect(result).not.toHaveProperty('datetime');
    expect(result).toEqual({ BTC: '1' });
  });

  it('should skip zero balances', () => {
    const ccxtBalance = {
      BTC: { total: 1.0 },
      ETH: { total: 0 },
      USD: { total: 0 },
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result).toEqual({ BTC: '1' });
    expect(result).not.toHaveProperty('ETH');
    expect(result).not.toHaveProperty('USD');
  });

  it('should handle missing total field', () => {
    const ccxtBalance = {
      BTC: { free: 1.0, used: 0.5 }, // no total
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result).toEqual({});
  });

  it('should handle empty balance object', () => {
    const ccxtBalance = {
      info: {},
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result).toEqual({});
  });

  it('should convert numbers to strings', () => {
    const ccxtBalance = {
      BTC: { total: 1.23456789 },
      ETH: { total: 10 },
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result['BTC']).toBe('1.23456789');
    expect(result['ETH']).toBe('10');
    expect(typeof result['BTC']).toBe('string');
    expect(typeof result['ETH']).toBe('string');
  });

  it('should handle negative balances', () => {
    const ccxtBalance = {
      BTC: { total: -0.5 }, // margin trading
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result).toEqual({ BTC: '-0.5' });
  });

  it('should use normalizeAsset function when provided', () => {
    const ccxtBalance = {
      'BTC.USD': { total: 1.0 },
      'ETH/USDT': { total: 10.0 },
    };

    const normalizeAsset = (assetSymbol: string) => assetSymbol.replace(/[./].*$/, '');

    const result = processCCXTBalance(ccxtBalance, normalizeAsset);

    expect(result).toEqual({
      BTC: '1',
      ETH: '10',
    });
  });

  it('should not normalize when function not provided', () => {
    const ccxtBalance = {
      'BTC.USD': { total: 1.0 },
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result).toEqual({
      'BTC.USD': '1',
    });
  });

  it('should handle multiple assets with normalizeAsset', () => {
    const ccxtBalance = {
      BTC: { total: 1.0 },
      btc: { total: 0.5 },
      'BTC-USD': { total: 2.0 },
    };

    const normalizeAsset = (assetSymbol: string) => assetSymbol.toUpperCase().split('-')[0]!;

    const result = processCCXTBalance(ccxtBalance, normalizeAsset);

    // All will be normalized to BTC, last one wins
    expect(Object.keys(result)).toContain('BTC');
  });

  it('should handle very large balance numbers', () => {
    const ccxtBalance = {
      SHIB: { total: 1000000000 }, // 1 billion
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result['SHIB']).toBe('1000000000');
  });

  it('should handle very small balance numbers', () => {
    const ccxtBalance = {
      BTC: { total: 0.00000001 }, // 1 satoshi
    };

    const result = processCCXTBalance(ccxtBalance);

    // JavaScript toString() for very small numbers uses scientific notation
    expect(result['BTC']).toBe('1e-8');
  });

  it('should handle mixed case currency names', () => {
    const ccxtBalance = {
      btc: { total: 1.0 },
      ETH: { total: 10.0 },
      uSd: { total: 5000 },
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result['btc']).toBe('1');
    expect(result['ETH']).toBe('10');
    expect(result['uSd']).toBe('5000');
  });

  it('should handle currencies with special characters', () => {
    const ccxtBalance = {
      'BTC-USD': { total: 1.0 },
      'ETH/USDT': { total: 10.0 },
      'BNB:BUSD': { total: 100 },
    };

    const result = processCCXTBalance(ccxtBalance);

    expect(result['BTC-USD']).toBe('1');
    expect(result['ETH/USDT']).toBe('10');
    expect(result['BNB:BUSD']).toBe('100');
  });
});
