import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getExchangeCredentialsFromEnv } from '../balance-utils.js';

describe('getExchangeCredentialsFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return credentials from environment variables', () => {
    process.env['KRAKEN_API_KEY'] = 'env-key';
    process.env['KRAKEN_SECRET'] = 'env-secret';

    const result = getExchangeCredentialsFromEnv('kraken');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        apiKey: 'env-key',
        apiSecret: 'env-secret',
      });
    }
  });

  it('should include passphrase if present', () => {
    process.env['KUCOIN_API_KEY'] = 'env-key';
    process.env['KUCOIN_SECRET'] = 'env-secret';
    process.env['KUCOIN_PASSPHRASE'] = 'env-passphrase';

    const result = getExchangeCredentialsFromEnv('kucoin');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        apiKey: 'env-key',
        apiSecret: 'env-secret',
        apiPassphrase: 'env-passphrase',
      });
    }
  });

  it.skipIf(!!originalEnv['KRAKEN_API_KEY'])('should return error when API key is missing', () => {
    process.env['KRAKEN_SECRET'] = 'env-secret';

    const result = getExchangeCredentialsFromEnv('kraken');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Missing KRAKEN_API_KEY or KRAKEN_SECRET in environment');
    }
  });

  it.skipIf(!!originalEnv['KRAKEN_SECRET'])('should return error when API secret is missing', () => {
    process.env['KRAKEN_API_KEY'] = 'env-key';

    const result = getExchangeCredentialsFromEnv('kraken');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe('Missing KRAKEN_API_KEY or KRAKEN_SECRET in environment');
    }
  });

  it('should handle uppercase exchange names', () => {
    process.env['BINANCE_API_KEY'] = 'env-key';
    process.env['BINANCE_SECRET'] = 'env-secret';

    const result = getExchangeCredentialsFromEnv('binance');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.apiKey).toBe('env-key');
      expect(result.value.apiSecret).toBe('env-secret');
    }
  });
});
