# `@exitbook/blockchain-providers`

Managed blockchain provider runtime with provider discovery, failover, health stats, and token metadata support.

This package gives you a managed blockchain runtime: create one runtime, use its methods directly, and clean it up when you are done. Chain-specific helpers are available from explicit subpaths.

## What It Does

- Create a multi-provider blockchain runtime
- Stream address transactions with failover support
- Fetch balances, token balances, address info, and token metadata
- Discover registered providers and read persisted health stats
- Support chain-specific helpers through explicit subpaths like `@exitbook/blockchain-providers/bitcoin`

## Quick Start

```ts
import { createBlockchainProviderRuntime } from '@exitbook/blockchain-providers';

const runtimeResult = await createBlockchainProviderRuntime({
  dataDir: './data',
});

if (runtimeResult.isErr()) {
  throw runtimeResult.error;
}

const runtime = runtimeResult.value;

const balancesResult = await runtime.getAddressBalances('bitcoin', 'bc1qexample...');
if (balancesResult.isErr()) {
  throw balancesResult.error;
}

for await (const stepResult of runtime.streamAddressTransactions('ethereum', '0x1234...')) {
  if (stepResult.isErr()) {
    throw stepResult.error;
  }

  console.log(stepResult.value.provider, stepResult.value.data.length);
}

const cleanupResult = await runtime.cleanup();
if (cleanupResult.isErr()) {
  throw cleanupResult.error;
}
```

## Root API

Primary runtime and discovery:

- `createBlockchainProviderRuntime(options)`
- `listBlockchainProviders()`
- `loadBlockchainProviderHealthStats(dataDir)`
- `loadBlockchainExplorerConfig(path?)`

Key public types:

- `IBlockchainProviderRuntime`
- `BlockchainProviderRuntimeOptions`
- `BlockchainProviderSelectionOptions`
- `BlockchainTransactionStreamOptions`
- `BlockchainBalanceQueryOptions`
- `BlockchainProviderDescriptor`
- `ProviderEvent`
- `ProviderError`

Useful domain types:

- `RawBalanceData`
- `TransactionWithRawData`
- `NormalizedTransactionBase`
- `ProviderOperationType`
- `ProviderStatsSnapshot`
- `TokenMetadataRecord`

## Configuration Notes

- `dataDir` is package-owned persistence config.
- `explorerConfig` is optional explicit config for provider overrides.
- `eventBus` and `instrumentation` are optional host integrations.
- The package does not read environment variables for you.

The runtime initializes and owns:

- provider health persistence
- token metadata persistence
- background provider tasks

## Subpaths

Chain-specific helpers and schemas are exported from explicit subpaths:

- `@exitbook/blockchain-providers/bitcoin`
- `@exitbook/blockchain-providers/cardano`
- `@exitbook/blockchain-providers/cosmos`
- `@exitbook/blockchain-providers/evm`
- `@exitbook/blockchain-providers/near`
- `@exitbook/blockchain-providers/solana`
- `@exitbook/blockchain-providers/substrate`
- `@exitbook/blockchain-providers/theta`
- `@exitbook/blockchain-providers/xrp`

Additional capability subpaths:

- `@exitbook/blockchain-providers/asset-review`
- `@exitbook/blockchain-providers/benchmark`

Use the root entrypoint for runtime and discovery. Use subpaths when you need chain-specific schemas, address helpers, or benchmark/asset-review helpers.
