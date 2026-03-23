# `@exitbook/price-providers`

Multi-provider historical price lookup for crypto and fiat assets.

This package gives you one primary entrypoint, `createPriceProviderRuntime(...)`, plus discovery and cache utilities. It owns its internal provider composition and persistence setup behind a small runtime facade.

## What It Does

- Fetch historical prices with provider failover
- Persist price cache data in `prices.db`
- Accept manual price and FX overrides
- Expose a small discovery API for the built-in providers

## Quick Start

```ts
import { Decimal } from 'decimal.js';

import { createPriceProviderRuntime } from '@exitbook/price-providers';

const runtimeResult = await createPriceProviderRuntime({
  dataDir: './data',
  providers: {
    coingecko: {
      apiKey: process.env['COINGECKO_API_KEY'],
      useProApi: true,
    },
    cryptocompare: {
      apiKey: process.env['CRYPTOCOMPARE_API_KEY'],
    },
  },
  behavior: {
    defaultCurrency: 'USD',
    cacheTtlSeconds: 3600,
  },
});

if (runtimeResult.isErr()) {
  throw runtimeResult.error;
}

const runtime = runtimeResult.value;

const priceResult = await runtime.fetchPrice({
  assetSymbol: 'BTC',
  currency: 'USD',
  timestamp: new Date('2024-01-01T12:00:00Z'),
});

if (priceResult.isErr()) {
  throw priceResult.error;
}

console.log(priceResult.value.price.toString());

await runtime.setManualPrice({
  assetSymbol: 'BTC',
  currency: 'USD',
  date: new Date('2024-01-01T12:00:00Z'),
  price: new Decimal('42000'),
  source: 'manual',
});

const cleanupResult = await runtime.cleanup();
if (cleanupResult.isErr()) {
  throw cleanupResult.error;
}
```

## Root API

- `createPriceProviderRuntime(options)`
- `listPriceProviders()`
- `readPriceCacheFreshness(dataDir)`
- `CoinNotFoundError`
- `PriceDataUnavailableError`

Key public types:

- `IPriceProviderRuntime`
- `PriceProviderRuntimeOptions`
- `PriceProviderConfig`
- `PriceQuery`
- `PriceData`
- `ManualPriceEntry`
- `ManualFxRateEntry`

## Built-In Providers

Use `listPriceProviders()` to inspect the built-in catalog. Current built-ins are:

- `bank-of-canada`
- `binance`
- `coingecko`
- `cryptocompare`
- `ecb`
- `frankfurter`

## Configuration Notes

- Pass credentials and toggles explicitly in `options.providers`.
- Pass runtime tuning in `options.behavior`.
- The package does not read `process.env` for you.
- `dataDir` is package-owned persistence config; this package stores its cache in `prices.db`.

## Events

If you want lifecycle events, provide `eventBus` in `PriceProviderRuntimeOptions`. The event payloads use the exported `PriceProviderEvent` type.
