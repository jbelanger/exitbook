import {
  ExchangeClientCredentialsSchema,
  ExchangeClientTransactionSchema,
  createExchangeClient,
  listExchangeProviders,
  type ExchangeClientCredentials,
  type ExchangeClientTransaction,
  type ExchangeProviderDescriptor,
} from '@exitbook/exchange-providers';
import {
  createCoinbaseClient,
  type CoinbaseCredentials,
  type RawCoinbaseLedgerEntry,
} from '@exitbook/exchange-providers/coinbase';
import {
  createKrakenClient,
  normalizeKrakenAsset,
  type KrakenCredentials,
  type KrakenLedgerEntry,
} from '@exitbook/exchange-providers/kraken';
import { createKuCoinClient, type KuCoinCredentials } from '@exitbook/exchange-providers/kucoin';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('published package exports', () => {
  it('exposes the curated root facade', async () => {
    const moduleExports = await import('@exitbook/exchange-providers');

    expect(Object.keys(moduleExports).sort()).toEqual(
      [
        'ExchangeClientCredentialsSchema',
        'ExchangeClientTransactionSchema',
        'createExchangeClient',
        'listExchangeProviders',
      ].sort()
    );

    expect(typeof createExchangeClient).toBe('function');
    expect(typeof listExchangeProviders).toBe('function');
    expect(ExchangeClientCredentialsSchema).toBeDefined();
    expect(ExchangeClientTransactionSchema).toBeDefined();

    expectTypeOf<ExchangeProviderDescriptor>().toMatchTypeOf<{
      displayName: string;
      name: string;
    }>();
    expectTypeOf<ExchangeClientCredentials>().toMatchTypeOf<{
      apiKey: string;
      apiSecret: string;
    }>();
    expectTypeOf<ExchangeClientTransaction>().toMatchTypeOf<{
      eventId: string;
      providerName: string;
    }>();
  });

  it('exposes a curated coinbase subpath', async () => {
    const moduleExports = await import('@exitbook/exchange-providers/coinbase');

    expect(Object.keys(moduleExports).sort()).toEqual(['createCoinbaseClient']);
    expect(typeof createCoinbaseClient).toBe('function');

    expectTypeOf<CoinbaseCredentials>().toMatchTypeOf<{
      apiKey: string;
      apiSecret: string;
    }>();
    expectTypeOf<RawCoinbaseLedgerEntry>().toMatchTypeOf<{
      id: string;
      type: string;
    }>();
  });

  it('exposes a curated kraken subpath', async () => {
    const moduleExports = await import('@exitbook/exchange-providers/kraken');

    expect(Object.keys(moduleExports).sort()).toEqual(['createKrakenClient', 'normalizeKrakenAsset']);
    expect(typeof createKrakenClient).toBe('function');
    expect(typeof normalizeKrakenAsset).toBe('function');

    expectTypeOf<KrakenCredentials>().toMatchTypeOf<{
      apiKey: string;
      apiSecret: string;
    }>();
    expectTypeOf<KrakenLedgerEntry>().toMatchTypeOf<{
      asset: string;
      id: string;
    }>();
  });

  it('exposes a curated kucoin subpath', async () => {
    const moduleExports = await import('@exitbook/exchange-providers/kucoin');

    expect(Object.keys(moduleExports).sort()).toEqual(['createKuCoinClient']);
    expect(typeof createKuCoinClient).toBe('function');

    expectTypeOf<KuCoinCredentials>().toMatchTypeOf<{
      apiKey: string;
      apiPassphrase: string;
      apiSecret: string;
    }>();
  });
});
