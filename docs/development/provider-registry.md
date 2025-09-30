# Provider Registry System

This document explains the provider registry system, a core component of the Universal Blockchain Provider & ETL Architecture. It enables a type-safe, auto-discovering, and highly extensible approach to managing blockchain API providers.

## Overview

The Provider Registry system solves the critical problem of decoupling provider _implementation_ from system _configuration_. It establishes a "single source of truth" for provider capabilities, where metadata lives directly with the code that implements it.

**Key Goals Achieved:**

- ✅ **Provider metadata lives with the code:** Rate limits, capabilities, and network URLs are defined in one place.
- ✅ **Configuration contains only user intent:** The JSON config is simplified to what's enabled, what's prioritized, and what's overridden.
- ✅ **Auto-discovery of providers:** New providers are automatically detected by the system once their files are created and imported.
- ✅ **Runtime validation:** The system validates user configuration against the registry, providing clear errors for typos or unsupported providers.
- ✅ **Improved Developer Experience:** The entire system is self-documenting and provides strong type safety.

## Architecture: From Disconnected to Integrated

### Before: The Disconnect Problem

The old way of managing providers led to a fragile system where a simple string in a JSON file was loosely connected to a class implementation.

```
JSON Config: "mempool.space"  ---(fragile link)-->  MempoolSpaceProvider class
     │                                                     │
     └─ No validation, prone to typos,         └─ Metadata scattered,
        runtime failures.                           manual instantiation required.
```

### After: The Registry Solution

The registry acts as a central service locator, creating a robust link between configuration and implementation.

```
// 1. API Client decorated with its metadata
@RegisterApiClient({ name: 'mempool.space', ... })
class MempoolSpaceApiClient { ... }
    │
    └─(registers itself on import)─┐
                                   ▼
// 2. A central, in-memory registry
 ProviderRegistry
    ▲
    │
// 3. System components query the registry
BlockchainProviderManager  ──(looks up "mempool.space")─┘
```

## Creating a New Provider (API Client)

Adding a new provider is a procedural process involving two key components: the `ApiClient` and the `Mapper`.

### 1. Implement the API Client Class

The `ApiClient` is responsible for communicating with the external API. It extends `BaseRegistryProvider` and is decorated with its metadata.

**File Location:** `packages/import/src/blockchains/<chain>/api/<ProviderName>ApiClient.ts`

```typescript
// packages/import/src/blockchains/bitcoin/api/MyBitcoinApiClient.ts
import { BaseRegistryProvider, RegisterApiClient } from '@exitbook/import'; // Simplified import path for example

@RegisterApiClient({
  // --- Core Metadata ---
  name: 'my-btc-provider', // Unique key used in config.json
  blockchain: 'bitcoin',
  displayName: 'My Custom BTC Provider',
  description: 'A custom provider for Bitcoin blockchain data.',

  // --- Configuration ---
  type: 'rest', // 'rest', 'rpc', or 'websocket'
  requiresApiKey: true,
  apiKeyEnvVar: 'MY_BTC_PROVIDER_API_KEY', // Recommended env var for the API key

  // --- Default Settings (can be overridden in config.json) ---
  defaultConfig: {
    timeout: 15000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 2.0,
      burstLimit: 5,
    },
  },

  // --- Network Endpoints ---
  networks: {
    mainnet: {
      baseUrl: 'https://api.myprovider.com/btc/v1',
    },
    testnet: {
      baseUrl: 'https://testnet-api.myprovider.com/btc/v1',
    },
  },

  // --- Capabilities ---
  capabilities: {
    supportedOperations: ['getRawAddressTransactions', 'getRawAddressBalance'],
    supportsHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: false,
    supportsTokenData: false,
  },
})
export class MyBitcoinApiClient extends BaseRegistryProvider {
  constructor() {
    // The base class handles initialization using the metadata above.
    super('bitcoin', 'my-btc-provider', 'mainnet');
  }

  // Implement the execute method to handle operations
  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    // ... implementation for getRawAddressTransactions, etc.
  }

  // Implement the health check
  async isHealthy(): Promise<boolean> {
    // ... implementation for health check
  }
}
```

### 2. Implement the Mapper Class

The `Mapper` is responsible for validating and transforming the raw JSON response from your API into the system's standardized `UniversalBlockchainTransaction` format.

**File Location:** `packages/import/src/blockchains/<chain>/mappers/<ProviderName>Mapper.ts`

```typescript
// packages/import/src/blockchains/bitcoin/mappers/MyBitcoinMapper.ts
import { BaseRawDataMapper, RegisterTransactionMapper } from '@exitbook/import';
import { ZodSchema, z } from 'zod'; // For validation

// Define a Zod schema for the raw API response
const MyRawTxSchema = z.object({
  /* ... */
});

@RegisterTransactionMapper('my-btc-provider') // Must match the ApiClient name
export class MyBitcoinMapper extends BaseRawDataMapper<MyRawTx> {
  protected readonly schema: ZodSchema = MyRawTxSchema;

  protected mapInternal(
    rawData: MyRawTx,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
    // 1. Validate the rawData using this.schema (done automatically by base class).
    // 2. Write the logic to transform the rawData into one or more
    //    UniversalBlockchainTransaction objects.
    // 3. Return ok([...transactions]) or err('...');
  }
}
```

### 3. Trigger Registration

Import the new files in the corresponding `index.ts` files to ensure their decorators are executed at application startup.

```typescript
// packages/import/src/blockchains/bitcoin/api/index.ts
import './MyBitcoinApiClient.ts'; // Add this line
import './MempoolSpaceApiClient.ts';
// ... other clients

// packages/import/src/blockchains/bitcoin/mappers/index.ts
import './MyBitcoinMapper.ts'; // Add this line
import './MempoolSpaceMapper.ts';
// ... other mappers
```

### 4. Update Configuration (Optional)

You can now use your new provider. Run the sync script to automatically add it to your configuration.

```bash
pnpm --filter @exitbook/import run providers:sync --fix
```

Your `blockchain-explorers.json` will be updated:

```json
{
  "bitcoin": {
    "defaultEnabled": [
      "blockchain.com",
      "blockstream.info",
      "mempool.space",
      "my-btc-provider" // Automatically added!
    ],
    "overrides": {
      // You can now add overrides if needed
      "my-btc-provider": {
        "priority": 4,
        "timeout": 20000
      }
    }
  }
}
```

## Registry Metadata Fields Reference

All metadata is defined within the `@RegisterApiClient` decorator.

| Field               | Type                   | Description                                                                                                              |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **`name`**          | `string`               | **Required.** The unique, machine-readable identifier for the provider. This key is used in `blockchain-explorers.json`. |
| **`blockchain`**    | `string`               | **Required.** The blockchain this provider serves (e.g., "bitcoin", "ethereum").                                         |
| **`displayName`**   | `string`               | **Required.** A human-friendly name for logging and UI purposes.                                                         |
| `description`       | `string`               | Optional. A brief description of the provider and its features.                                                          |
| `type`              | `'rest' \| 'rpc'`      | Optional. The type of API. Defaults to `rest`.                                                                           |
| `requiresApiKey`    | `boolean`              | Optional. Set to `true` if the provider needs an API key. Defaults to `false`.                                           |
| `apiKeyEnvVar`      | `string`               | Optional. The recommended environment variable name for the API key (e.g., `MEMPOOL_API_KEY`).                           |
| **`defaultConfig`** | `object`               | **Required.** Contains default settings for the provider.                                                                |
| ┝ `timeout`         | `number`               | **Required.** Default request timeout in milliseconds.                                                                   |
| ┝ `retries`         | `number`               | **Required.** Default number of retry attempts on failure.                                                               |
| ┝ `rateLimit`       | `RateLimitConfig`      | **Required.** The rate limiting rules for the provider.                                                                  |
| **`networks`**      | `object`               | **Required.** Defines the API endpoints for different networks.                                                          |
| ┝ `mainnet`         | `NetworkEndpoint`      | **Required.** The configuration for the main network.                                                                    |
| ┝ `testnet`         | `NetworkEndpoint`      | Optional. Configuration for a test network.                                                                              |
| **`capabilities`**  | `ProviderCapabilities` | **Required.** An object declaring what operations the provider supports.                                                 |

## Using the Registry System

### Command Line Tools

The monorepo includes scripts to help you manage and validate your provider ecosystem.

```bash
# List all registered providers across all blockchains and their metadata.
pnpm --filter @exitbook/import run providers:list

# Validate that all provider registrations are well-formed and complete.
pnpm --filter @exitbook/import run providers:validate

# Sync the blockchain-explorers.json file with the registry.
# The --fix flag will automatically add any newly registered providers.
pnpm --filter @exitbook/import run providers:sync --fix

# Validate the existing blockchain-explorers.json against the registry.
# This will catch typos or references to providers that are no longer registered.
pnpm --filter @exitbook/import run config:validate
```

### Programmatic Usage

While most interaction is automated, you can interact with the registry programmatically.

```typescript
import { ProviderRegistry } from '@exitbook/import';

// Get metadata for a specific provider
const alchemyMeta = ProviderRegistry.getMetadata('ethereum', 'alchemy');

// Check if a provider is registered
const isRegistered = ProviderRegistry.isRegistered('solana', 'helius');
```

## Configuration Schema (`blockchain-explorers.json`)

The registry system allows for a clean and powerful configuration file that focuses on user intent.

```json
{
  "ethereum": {
    // An array of provider names to enable by default.
    // The order does not matter here; priority is set in `overrides`.
    "defaultEnabled": ["alchemy", "moralis"],

    // An object to customize specific providers.
    "overrides": {
      "alchemy": {
        "priority": 1, // Lower is higher priority. Alchemy will be tried first.
        "timeout": 20000, // Override the default timeout from the decorator.
        "rateLimit": {
          // Override the default rate limit.
          "requestsPerSecond": 10
        }
      },
      "moralis": {
        "priority": 2
      },
      "some-other-provider": {
        "enabled": false // Explicitly disable a provider, even if it's registered.
      }
    }
  },
  "bitcoin": {
    // If 'overrides' is omitted, all providers in defaultEnabled
    // will be used with their default settings and an equal priority.
    "defaultEnabled": ["mempool.space", "blockstream.info"]
  }
}
```

## Troubleshooting

### Provider 'xyz' not found for blockchain 'abc'

- **Cause:** The provider's file was not imported, so its `@RegisterApiClient` decorator never ran.
- **Solution:** Ensure you have added `import './path/to/XyzApiClient.ts';` in the `api/index.ts` file for the corresponding blockchain.

### Configuration Validation Fails

- **Cause:** A provider name in `blockchain-explorers.json` has a typo or refers to a provider that has been removed.
- **Solution:** Run `pnpm run providers:list` to see the correct, available provider names. Correct the typo in the JSON file. Run `pnpm run config:validate` again to confirm.

### API Key Not Being Used

- **Cause:** The `requiresApiKey` flag is `false` in the decorator, or the `apiKeyEnvVar` is incorrect.
- **Solution:** Verify the metadata in the `@RegisterApiClient` decorator. Ensure `requiresApiKey` is `true` and the `apiKeyEnvVar` matches the variable in your `.env` file.
