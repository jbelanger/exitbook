import { describe, expect, it } from 'vitest';

import { normalizeCCXTBalance } from '../ccxt-balance.js';

describe('normalizeCCXTBalance', () => {
  it('should process balance with multiple currencies', () => {
    const ccxtBalance = {
      BTC: { total: 1.5, free: 1.0, used: 0.5 },
      ETH: { total: 10.0, free: 8.0, used: 2.0 },
      USD: { total: 5000, free: 5000, used: 0 },
      info: {},
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
    };

    const result = normalizeCCXTBalance(ccxtBalance);

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

    const result = normalizeCCXTBalance(ccxtBalance);

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

    const result = normalizeCCXTBalance(ccxtBalance);

    expect(result).toEqual({ BTC: '1' });
    expect(result).not.toHaveProperty('ETH');
    expect(result).not.toHaveProperty('USD');
  });

  it('should handle missing total field', () => {
    const ccxtBalance = {
      BTC: { free: 1.0, used: 0.5 },
    };

    const result = normalizeCCXTBalance(ccxtBalance);

    expect(result).toEqual({});
  });

  it('should handle empty balance object', () => {
    const ccxtBalance = {
      info: {},
      timestamp: 1704067200000,
      datetime: '2024-01-01T00:00:00.000Z',
    };

    const result = normalizeCCXTBalance(ccxtBalance);

    expect(result).toEqual({});
  });

  it('should convert numbers to strings', () => {
    const ccxtBalance = {
      BTC: { total: 1.23456789 },
      ETH: { total: 10 },
    };

    const result = normalizeCCXTBalance(ccxtBalance);

    expect(result['BTC']).toBe('1.23456789');
    expect(result['ETH']).toBe('10');
    expect(typeof result['BTC']).toBe('string');
    expect(typeof result['ETH']).toBe('string');
  });

  it('should handle negative balances', () => {
    const ccxtBalance = {
      BTC: { total: -0.5 },
    };

    const result = normalizeCCXTBalance(ccxtBalance);

    expect(result).toEqual({ BTC: '-0.5' });
  });

  it('should use normalizeAsset function when provided', () => {
    const ccxtBalance = {
      'BTC.USD': { total: 1.0 },
      'ETH/USDT': { total: 10.0 },
    };

    const normalizeAsset = (assetSymbol: string) => assetSymbol.replace(/[./].*$/, '');

    const result = normalizeCCXTBalance(ccxtBalance, normalizeAsset);

    expect(result).toEqual({
      BTC: '1',
      ETH: '10',
    });
  });

  it('should not normalize when function not provided', () => {
    const ccxtBalance = {
      'BTC.USD': { total: 1.0 },
    };

    const result = normalizeCCXTBalance(ccxtBalance);

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

    const result = normalizeCCXTBalance(ccxtBalance, normalizeAsset);

    expect(Object.keys(result)).toContain('BTC');
  });

  it('should handle very large balance numbers', () => {
    const ccxtBalance = {
      SHIB: { total: 1000000000 },
    };

    const result = normalizeCCXTBalance(ccxtBalance);

    expect(result['SHIB']).toBe('1000000000');
  });

  it('should handle very small balance numbers', () => {
    const ccxtBalance = {
      BTC: { total: 0.00000001 },
    };

    const result = normalizeCCXTBalance(ccxtBalance);

    expect(result['BTC']).toBe('1e-8');
  });

  it('should handle mixed case currency names', () => {
    const ccxtBalance = {
      btc: { total: 1.0 },
      ETH: { total: 10.0 },
      uSd: { total: 5000 },
    };

    const result = normalizeCCXTBalance(ccxtBalance);

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

    const result = normalizeCCXTBalance(ccxtBalance);

    expect(result['BTC-USD']).toBe('1');
    expect(result['ETH/USDT']).toBe('10');
    expect(result['BNB:BUSD']).toBe('100');
  });
});
