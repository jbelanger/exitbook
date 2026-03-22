import { describe, expect, it } from 'vitest';

import { createExchangeClient, listExchangeProviders } from '../create-exchange-client.js';

describe('createExchangeClient', () => {
  it('describes the supported exchange providers', () => {
    expect(listExchangeProviders()).toEqual([
      {
        name: 'coinbase',
        displayName: 'Coinbase',
        supportsBalance: true,
        supportsTransactionStreaming: true,
      },
      {
        name: 'kraken',
        displayName: 'Kraken',
        supportsBalance: true,
        supportsTransactionStreaming: true,
      },
      {
        name: 'kucoin',
        displayName: 'KuCoin',
        requiresPassphrase: true,
        supportsBalance: true,
        supportsTransactionStreaming: false,
      },
    ]);
  });

  it('creates a client for a supported exchange name regardless of casing', () => {
    const result = createExchangeClient('KrAkEn', {
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }

    expect(result.value.exchangeId).toBe('kraken');
  });

  it('returns a helpful error for unsupported exchange names', () => {
    const result = createExchangeClient('binance', {
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      return;
    }

    expect(result.error.message).toContain('Unknown exchange: binance');
    expect(result.error.message).toContain('coinbase, kraken, kucoin');
  });
});
