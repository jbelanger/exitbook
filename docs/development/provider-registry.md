# Provider Registry System

This document explains the new provider registry system that eliminates the disconnect between JSON configuration and provider implementations.

## Overview

The Provider Registry system creates a **type-safe, self-documenting** approach to blockchain provider management where:

- ✅ **Provider metadata lives with the code** (rate limits, URLs, capabilities)
- ✅ **JSON config only contains user preferences** (enabled/disabled, priorities, overrides)
- ✅ **Strong connection** between configuration and implementation
- ✅ **Auto-discovery** of available providers
- ✅ **Runtime validation** of configurations

## Architecture

### Before: Disconnect Problem

```
JSON Config: "etherscan"  ❌  EtherscanProvider class
     ↓                              ↓
Hard to connect             Metadata scattered
No validation              Manual instantiation
Runtime failures           No auto-discovery
```

### After: Registry Solution

```
@RegisterProvider({...})           ProviderRegistry
EtherscanProvider  ➜  Registration  ➜  Auto-discovery
     ↑                              ↓
Metadata with code            JSON validation
Self-documenting             Type-safe creation
```

## Creating a New Provider

### 1. Implement the Provider Class

```typescript
import { IBlockchainProvider } from '../../core/types/index.js';
import { RegisterProvider } from '../registry/index.js';

@RegisterProvider({
  name: 'my-provider',
  blockchain: 'ethereum',
  displayName: 'My Custom Provider',
  description: 'A custom provider for Ethereum blockchain data',
  requiresApiKey: true,
  type: 'rest',
  defaultConfig: {
    timeout: 15000,
    retries: 3,
    rateLimit: {
      requestsPerSecond: 1.0,
      requestsPerMinute: 30,
      requestsPerHour: 100,
      burstLimit: 2,
    },
  },
  networks: {
    mainnet: {
      baseUrl: 'https://api.myprovider.com/v1',
    },
    testnet: {
      baseUrl: 'https://testnet-api.myprovider.com/v1',
    },
  },
})
export class MyProvider implements IBlockchainProvider<MyProviderConfig> {
  readonly name = 'my-provider';
  readonly blockchain = 'ethereum';
  readonly capabilities = {
    supportedOperations: ['getAddressTransactions', 'getAddressBalance'],
    maxBatchSize: 1,
    providesHistoricalData: true,
    supportsPagination: true,
  };

  constructor(private config: MyProviderConfig) {
    // Provider initialization
  }

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    // Implementation
  }
}
```

### 2. Register in Adapter

Import the provider to trigger registration:

```typescript
// src/adapters/blockchains/ethereum-adapter.ts
import '../../providers/ethereum/MyProvider.js';

// This triggers @RegisterProvider
```

### 3. Add to Configuration

```json
{
  "ethereum": {
    "explorers": [
      {
        "name": "my-provider",
        "enabled": true,
        "priority": 3,
        "timeout": 20000
      }
    ]
  }
}
```

## Registry Metadata Fields

### Required Fields

| Field                      | Type            | Description                                      |
| -------------------------- | --------------- | ------------------------------------------------ |
| `name`                     | string          | Unique provider identifier (used in JSON config) |
| `blockchain`               | string          | Target blockchain (ethereum, bitcoin, etc.)      |
| `displayName`              | string          | Human-readable provider name                     |
| `defaultConfig.timeout`    | number          | Request timeout in milliseconds                  |
| `defaultConfig.retries`    | number          | Number of retry attempts                         |
| `defaultConfig.rateLimit`  | RateLimitConfig | Rate limiting configuration                      |
| `networks.mainnet.baseUrl` | string          | Mainnet API endpoint                             |

### Optional Fields

| Field              | Type                           | Description                                  |
| ------------------ | ------------------------------ | -------------------------------------------- |
| `description`      | string                         | Provider description                         |
| `requiresApiKey`   | boolean                        | Whether API key is required (default: false) |
| `type`             | 'rest' \| 'rpc' \| 'websocket' | API type (default: 'rest')                   |
| `networks.testnet` | NetworkEndpoint                | Testnet configuration                        |
| `networks.devnet`  | NetworkEndpoint                | Development network configuration            |

### Rate Limit Configuration

```typescript
interface RateLimitConfig {
  requestsPerSecond: number; // Primary rate limit
  requestsPerMinute?: number; // Secondary rate limit
  requestsPerHour?: number; // Tertiary rate limit
  burstLimit?: number; // Burst capacity
}
```

## Using the Registry System

### List Available Providers

```typescript
import { ProviderRegistry } from './src/providers/registry/index.js';

// Get all providers for Ethereum
const ethereumProviders = ProviderRegistry.getAvailable('ethereum');
console.log(ethereumProviders.map(p => p.name)); // ['etherscan', 'alchemy', 'moralis']

// Get all providers across all blockchains
const allProviders = ProviderRegistry.getAllProviders();
```

### Create Provider Instance

```typescript
const config = {
  apiKey: process.env.ETHERSCAN_API_KEY,
  network: 'mainnet',
  timeout: 10000,
};

const provider = ProviderRegistry.createProvider('ethereum', 'etherscan', config);
```

### Validate Configuration

```typescript
const config = {
  ethereum: {
    explorers: [
      { name: 'etherscan', enabled: true, priority: 1 },
      { name: 'invalid-provider', enabled: true, priority: 2 },
    ],
  },
};

const validation = ProviderRegistry.validateConfig(config);
if (!validation.valid) {
  console.error('Configuration errors:', validation.errors);
  // ['Unknown provider 'invalid-provider' for blockchain 'ethereum'']
}
```

### Auto-Register from Configuration

```typescript
const manager = new BlockchainProviderManager();
const providers = manager.autoRegisterFromConfig('ethereum', 'mainnet');
// Automatically creates and registers all enabled providers from JSON config
```

## Command Line Tools

### Provider Commands

```bash
# List all registered providers
pnpm run providers:list

# Validate provider registrations
pnpm run providers:validate
```

### Configuration Commands

```bash
# Generate config template from registered providers
pnpm run config:generate

# Validate existing configuration
pnpm run config:validate
```

## Configuration Schema

### Simplified JSON Structure

With the registry system, your JSON config becomes much simpler:

```json
{
  "ethereum": {
    "explorers": [
      {
        "name": "etherscan", // Must match registered provider name
        "enabled": true, // Enable/disable this provider
        "priority": 1, // Lower = higher priority
        "timeout": 20000 // Override default timeout (optional)
      },
      {
        "name": "alchemy",
        "enabled": false, // Disabled provider
        "priority": 2
      }
    ]
  },
  "bitcoin": {
    "explorers": [
      {
        "name": "mempool.space",
        "enabled": true,
        "priority": 1
      }
    ]
  }
}
```

### Configuration Override Support

You can override any provider default in the JSON config:

```json
{
  "ethereum": {
    "explorers": [
      {
        "name": "etherscan",
        "enabled": true,
        "priority": 1,
        "timeout": 30000, // Override default timeout
        "retries": 5, // Override default retries
        "rateLimit": {
          // Override default rate limit
          "requestsPerSecond": 0.5
        }
      }
    ]
  }
}
```

## Error Messages

The registry provides clear error messages:

### Provider Not Found

```
Provider 'invalid-provider' not found for blockchain 'ethereum'.
Available providers: etherscan, alchemy, moralis
```

### Configuration Validation

```
Configuration errors:
- Unknown provider 'typo-provider' for blockchain 'ethereum'. Available: etherscan, alchemy, moralis
- Missing name for explorer in blockchain bitcoin
```

### Runtime Errors

```
No providers available for blockchain 'ethereum' and operation 'getAddressTransactions'
All providers failed for operation 'getAddressBalance'
```

## Migration Guide

### From Old System

**Old approach** (hardcoded instantiation):

```typescript
// ❌ Old way - manual provider creation
const etherscanProvider = new EtherscanProvider({
  apiKey: process.env.ETHERSCAN_API_KEY,
  network: 'mainnet',
});
```

**New approach** (registry-based):

```typescript
// ✅ New way - registry creation
const provider = ProviderRegistry.createProvider('ethereum', 'etherscan', {
  apiKey: process.env.ETHERSCAN_API_KEY,
  network: 'mainnet',
});
```

### Converting Existing Providers

1. **Add the `@RegisterProvider` decorator** with metadata
2. **Import the provider file** in the adapter to trigger registration
3. **Update JSON config** to reference by registered name
4. **Remove manual instantiation** code

## Best Practices

### Provider Implementation

- ✅ Use descriptive `displayName` and `description`
- ✅ Set realistic rate limits based on API documentation
- ✅ Include all supported networks (mainnet, testnet, devnet)
- ✅ Use consistent naming conventions

### Configuration

- ✅ Enable providers in priority order (1 = highest priority)
- ✅ Keep sensitive data in environment variables, not JSON
- ✅ Use configuration overrides sparingly
- ✅ Validate configuration before deployment

### Registry Management

- ✅ Import all provider files to trigger registration
- ✅ Use registry validation in CI/CD pipelines
- ✅ Generate fresh config templates after adding providers
- ✅ Document any custom provider requirements

## Benefits

### For Developers

- **Type Safety**: Invalid provider names caught at compile time
- **Auto-completion**: IDE support for provider names and configuration
- **Self-documenting**: Provider metadata embedded with implementation
- **Centralized**: Single source of truth for provider capabilities

### For Users

- **Clear Errors**: Helpful error messages for configuration issues
- **Easy Discovery**: Automatically see available providers
- **Simple Config**: Minimal JSON configuration required
- **Validation**: Configuration validated before runtime

### For Operations

- **Reliability**: Fewer runtime configuration errors
- **Monitoring**: Provider health and performance metrics
- **Flexibility**: Easy to enable/disable/prioritize providers
- **Scalability**: Easy to add new providers and blockchains

## Troubleshooting

### Provider Not Registered

**Problem**: `Provider 'etherscan' not found for blockchain 'ethereum'`

**Solutions**:

1. Ensure provider file is imported: `import '../../providers/ethereum/EtherscanProvider.js';`
2. Check `@RegisterProvider` decorator is present and correct
3. Verify provider name matches exactly

### Configuration Validation Fails

**Problem**: Configuration has unknown providers

**Solutions**:

1. Run `pnpm run providers:list` to see available providers
2. Check for typos in provider names
3. Ensure provider is properly registered

### Rate Limiting Issues

**Problem**: Too many API calls or slow responses

**Solutions**:

1. Check provider's rate limit configuration in `@RegisterProvider`
2. Override rate limits in JSON config if needed
3. Monitor provider health with `getProviderHealth()`

### Network Configuration Missing

**Problem**: Provider fails to connect to network

**Solutions**:

1. Verify network endpoints in `@RegisterProvider` metadata
2. Check if custom `baseUrl` needed in JSON config
3. Ensure API keys are properly configured
