import {
  CoinNotFoundError,
  PriceDataUnavailableError,
  createPriceProviderRuntime,
  listPriceProviders,
  readPriceCacheFreshness,
  type ManualFxRateEntry,
  type ManualPriceEntry,
  type PriceProviderDescriptor,
  type PriceProviderRuntimeOptions,
} from '@exitbook/price-providers';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('published package exports', () => {
  it('exposes the curated root facade', async () => {
    const moduleExports = await import('@exitbook/price-providers');

    expect(Object.keys(moduleExports).sort()).toEqual(
      [
        'CoinNotFoundError',
        'PriceDataUnavailableError',
        'createPriceProviderRuntime',
        'listPriceProviders',
        'readPriceCacheFreshness',
      ].sort()
    );

    expect(typeof createPriceProviderRuntime).toBe('function');
    expect(typeof listPriceProviders).toBe('function');
    expect(typeof readPriceCacheFreshness).toBe('function');
    expect(CoinNotFoundError).toBeDefined();
    expect(PriceDataUnavailableError).toBeDefined();

    expectTypeOf<PriceProviderDescriptor>().toMatchTypeOf<{
      displayName: string;
      name: string;
      requiresApiKey: boolean;
      supportedAssetTypes: string[];
    }>();
    expectTypeOf<PriceProviderRuntimeOptions>().toMatchTypeOf<{
      dataDir: string;
    }>();
    expectTypeOf<ManualPriceEntry>().toMatchTypeOf<{
      assetSymbol: string;
      date: Date;
      price: unknown;
    }>();
    expectTypeOf<ManualFxRateEntry>().toMatchTypeOf<{
      date: Date;
      from: string;
      rate: unknown;
      to: string;
    }>();
  });
});
