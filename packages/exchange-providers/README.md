# `@exitbook/exchange-providers`

Exchange client creation and shared exchange contracts for raw transaction and balance fetching.

This package is intentionally stateless: create a client, use it, discard it. There is no long-lived runtime manager.

## What It Does

- Create exchange API clients through one root factory
- Expose a discovery API for supported exchanges
- Share normalized contracts for streamed transaction batches and balances
- Provide explicit exchange-specific subpaths when you need a direct factory or raw provider DTOs

## Quick Start

```ts
import { createExchangeClient } from '@exitbook/exchange-providers';

const clientResult = createExchangeClient('kraken', {
  apiKey: process.env['KRAKEN_API_KEY']!,
  apiSecret: process.env['KRAKEN_API_SECRET']!,
});

if (clientResult.isErr()) {
  throw clientResult.error;
}

const client = clientResult.value;

for await (const batchResult of client.fetchTransactionDataStreaming()) {
  if (batchResult.isErr()) {
    throw batchResult.error;
  }

  console.log(batchResult.value.operationType, batchResult.value.transactions.length);
}

const balanceResult = await client.fetchBalance();
if (balanceResult.isErr()) {
  throw balanceResult.error;
}

console.log(balanceResult.value.balances);
```

## Root API

- `createExchangeClient(exchangeName, credentials)`
- `listExchangeProviders()`
- `ExchangeClientCredentialsSchema`
- `ExchangeClientTransactionSchema`

Key public types:

- `ExchangeName`
- `ExchangeProviderDescriptor`
- `IExchangeClient`
- `ExchangeClientCredentials`
- `ExchangeClientFetchParams`
- `ExchangeClientTransaction`
- `ExchangeClientTransactionBatch`
- `ExchangeBalanceSnapshot`

## Supported Exchanges

Use `listExchangeProviders()` to inspect the current catalog. Current root-supported exchanges are:

- `coinbase`
- `kraken`
- `kucoin`

## Subpaths

Use the root factory for the common case. Use subpaths when you need a direct exchange factory or exchange-specific raw DTOs:

- `@exitbook/exchange-providers/coinbase`
- `@exitbook/exchange-providers/kraken`
- `@exitbook/exchange-providers/kucoin`

## Configuration Notes

- Pass credentials explicitly; the package does not read environment variables for you.
- The root factory accepts `string` exchange names and returns a clear error listing supported exchanges when the name is unknown.
- Exchange-specific credential requirements are reflected in each exchange descriptor and subpath types.
