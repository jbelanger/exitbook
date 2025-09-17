# How to Add New Providers

> **📋 Open Source Notice**  
> This guide shows how to develop new blockchain providers for the Universal
> Provider Architecture. The core framework is open source, though you may
> integrate with third-party APIs that require commercial licenses.

## Overview

Adding a new provider to the Universal Blockchain Provider Architecture is a
straightforward process that follows established patterns. Whether you're adding
support for a new blockchain API or creating an alternative provider for an
existing blockchain, this guide will walk you through the entire process.

## Development Process Overview

```
1. Plan Provider → 2. Implement Interface → 3. Add Configuration → 4. Write Tests → 5. Deploy
     (30 min)           (2-4 hours)            (15 min)         (1 hour)      (15 min)
```

**Total Time Investment**: 4-6 hours for a complete provider implementation

## Step 1: Plan Your Provider

### Define Provider Scope

Before writing code, clearly define what your provider will do:

```typescript
// Example: New Solana provider planning
const providerPlan = {
  name: 'solana-rpc', // Unique identifier
  blockchain: 'solana', // Target blockchain
  capabilities: [
    'getAddressTransactions', // What operations it supports
    'getAddressBalance',
    'getTokenTransactions',
  ],
  apiEndpoint: 'https://api.mainnet-beta.solana.com',
  rateLimit: 100, // Requests per second
  requiresApiKey: false, // Authentication requirements
  cost: 'free', // Pricing model
};
```

### Research API Documentation

Gather essential information about the target API:

- **Endpoint URLs**: Base URL and specific endpoints
- **Authentication**: API key requirements, headers, authentication methods
- **Rate Limits**: Requests per second/minute/hour limitations
- **Response Format**: JSON structure, pagination, error formats
- **Error Handling**: HTTP status codes, error message formats

### Choose Provider Type

Determine which type of provider you're building:

#### Type 1: New Blockchain Provider

Adding support for a completely new blockchain (e.g., Solana, Cardano, Polygon)

#### Type 2: Alternative Provider

Adding an alternative API for existing blockchain (e.g., new Bitcoin API
alongside mempool.space)

#### Type 3: Specialized Provider

Adding specialized capabilities (e.g., NFT transactions, DeFi protocols, staking
data)

## Step 2: Implement the Provider Interface

### Core Interface Implementation

Every provider must implement the `IBlockchainProvider` interface:

```typescript
// src/providers/SolanaRPCProvider.ts
import { BlockchainTransaction } from '../types/blockchain';
import {
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderOperation,
  RateLimitConfig,
} from './IBlockchainProvider';

export class SolanaRPCProvider implements IBlockchainProvider<SolanaConfig> {
  readonly name = 'solana-rpc';
  readonly blockchain = 'solana';
  readonly capabilities: ProviderCapabilities = {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressBalance',
      'getTokenTransactions',
    ],
    maxBatchSize: 10,
    providesHistoricalData: true,
    supportsPagination: true,
    maxLookbackDays: 365,
    supportsRealTimeData: true,
    supportsTokenData: true,
  };
  readonly rateLimit: RateLimitConfig = {
    requestsPerSecond: 10,
    burstLimit: 20,
    backoffMs: 1000,
  };

  constructor(private config: SolanaConfig) {}

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test with a simple RPC call
      const response = await this.makeRequest('getVersion', []);
      return response.result !== undefined;
    } catch {
      return false;
    }
  }

  async execute<T>(
    operation: ProviderOperation<T>,
    config: SolanaConfig,
  ): Promise<T> {
    switch (operation.type) {
      case 'getAddressTransactions':
        return this.getAddressTransactions(operation.params) as T;
      case 'getAddressBalance':
        return this.getAddressBalance(operation.params) as T;
      case 'getTokenTransactions':
        return this.getTokenTransactions(operation.params) as T;
      default:
        throw new Error(`Unsupported operation: ${operation.type}`);
    }
  }

  // Implementation methods below...
}
```

### Implement Core Operations

#### Get Address Transactions

```typescript
private async getAddressTransactions(params: { address: string; since?: number }): Promise<BlockchainTransaction[]> {
  const { address, since } = params;

  // Build RPC request
  const rpcParams = {
    method: 'getConfirmedSignaturesForAddress2',
    params: [
      address,
      {
        limit: 1000,
        before: since ? this.timestampToSignature(since) : undefined
      }
    ]
  };

  const response = await this.makeRequest(rpcParams.method, rpcParams.params);

  // Transform Solana response to standard format
  return response.result.map(tx => this.transformTransaction(tx, address));
}

private transformTransaction(solanaTransaction: any, address: string): BlockchainTransaction {
  return {
    hash: solanaTransaction.signature,
    blockNumber: solanaTransaction.slot,
    timestamp: solanaTransaction.blockTime,
    from: this.extractSender(solanaTransaction),
    to: this.extractReceiver(solanaTransaction),
    value: this.extractValue(solanaTransaction),
    fee: this.extractFee(solanaTransaction),
    status: solanaTransaction.err ? 'failed' : 'confirmed',
    raw: solanaTransaction
  };
}
```

#### Get Address Balance

```typescript
private async getAddressBalance(params: { address: string; tokenAddress?: string }): Promise<{ balance: string; token: string }> {
  const { address, tokenAddress } = params;

  if (tokenAddress) {
    // SPL Token balance
    const response = await this.makeRequest('getTokenAccountsByOwner', [
      address,
      { mint: tokenAddress },
      { encoding: 'jsonParsed' }
    ]);

    const tokenAccount = response.result.value[0];
    return {
      balance: tokenAccount?.account.data.parsed.info.tokenAmount.uiAmountString || '0',
      token: tokenAddress
    };
  } else {
    // SOL balance
    const response = await this.makeRequest('getBalance', [address]);
    return {
      balance: (response.result.value / 1e9).toString(), // Convert lamports to SOL
      token: 'SOL'
    };
  }
}
```

### HTTP Request Handling

```typescript
private async makeRequest(method: string, params: any[]): Promise<any> {
  const requestBody = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params
  };

  const response = await fetch(this.config.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`Solana RPC error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Solana RPC error: ${data.error.message}`);
  }

  return data;
}
```

### Error Handling

```typescript
import { RateLimitError, AuthenticationError, ServiceUnavailableError } from '../utils/exchange-error-handler';

private handleError(error: any): never {
  // Check for specific Solana error types
  if (error.message?.includes('rate limit')) {
    throw new RateLimitError('Solana RPC rate limit exceeded');
  }

  if (error.message?.includes('unauthorized') || error.message?.includes('invalid api key')) {
    throw new AuthenticationError('Invalid Solana RPC credentials');
  }

  if (error.message?.includes('service unavailable') || error.code === 503) {
    throw new ServiceUnavailableError('Solana RPC service unavailable');
  }

  // Generic error
  throw new Error(`Solana RPC error: ${error.message}`);
}
```

## Step 3: Add Configuration Support

### Define Configuration Interface

```typescript
// src/types/solana.ts
export interface SolanaConfig {
  baseUrl: string;
  apiKey?: string;
  network: 'mainnet-beta' | 'testnet' | 'devnet';
  timeout?: number;
  retries?: number;
}
```

### Update Configuration Schema

```typescript
// src/types/blockchain.ts
export interface BlockchainConfig {
  enabled: boolean;
  options: {
    blockchain: string;
    providers: ProviderConfig[];
    // Add new blockchain support
    network?: 'mainnet' | 'testnet';
    timeout?: number;
  };
}

// Add to provider config union
export type ProviderSpecificConfig =
  | BitcoinConfig
  | EthereumConfig
  | InjectiveConfig
  | SolanaConfig; // New addition
```

### Example Configuration

```json
{
  "solana": {
    "enabled": true,
    "options": {
      "blockchain": "solana",
      "network": "mainnet-beta",
      "providers": [
        {
          "name": "solana-rpc",
          "priority": 1,
          "enabled": true,
          "baseUrl": "https://api.mainnet-beta.solana.com",
          "rateLimit": {
            "requestsPerSecond": 10
          }
        },
        {
          "name": "quicknode-solana",
          "priority": 2,
          "enabled": true,
          "apiKey": "env:QUICKNODE_SOLANA_API_KEY",
          "baseUrl": "https://your-endpoint.solana.quiknode.pro",
          "rateLimit": {
            "requestsPerSecond": 25
          }
        }
      ]
    }
  }
}
```

## Step 4: Write Comprehensive Tests

### Unit Tests

```typescript
// tests/providers/solana-rpc-provider.test.ts
import { SolanaRPCProvider } from '../../src/providers/SolanaRPCProvider';
import { SolanaConfig } from '../../src/types/solana';

describe('SolanaRPCProvider', () => {
  let provider: SolanaRPCProvider;
  let config: SolanaConfig;

  beforeEach(() => {
    config = {
      baseUrl: 'https://api.mainnet-beta.solana.com',
      network: 'mainnet-beta',
    };
    provider = new SolanaRPCProvider(config);
  });

  describe('Health Checks', () => {
    it('should report healthy when RPC is accessible', async () => {
      // Mock successful RPC response
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: { version: '1.14.0' } }),
      });

      const isHealthy = await provider.isHealthy();
      expect(isHealthy).toBe(true);
    });

    it('should report unhealthy when RPC is down', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const isHealthy = await provider.isHealthy();
      expect(isHealthy).toBe(false);
    });
  });

  describe('Address Transactions', () => {
    it('should fetch and transform transactions correctly', async () => {
      const mockResponse = {
        result: [
          {
            signature: 'test-signature-123',
            slot: 123456789,
            blockTime: 1640995200,
            err: null,
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const operation = {
        type: 'getAddressTransactions' as const,
        params: { address: 'test-address' },
      };

      const transactions = await provider.execute(operation, config);

      expect(transactions).toHaveLength(1);
      expect(transactions[0].hash).toBe('test-signature-123');
      expect(transactions[0].status).toBe('confirmed');
    });

    it('should handle failed transactions', async () => {
      const mockResponse = {
        result: [
          {
            signature: 'failed-signature',
            slot: 123456789,
            blockTime: 1640995200,
            err: { InstructionError: [0, 'Custom'] },
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const operation = {
        type: 'getAddressTransactions' as const,
        params: { address: 'test-address' },
      };

      const transactions = await provider.execute(operation, config);
      expect(transactions[0].status).toBe('failed');
    });
  });

  describe('Error Handling', () => {
    it('should throw RateLimitError for rate limit responses', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const operation = {
        type: 'getAddressTransactions' as const,
        params: { address: 'test-address' },
      };

      await expect(provider.execute(operation, config)).rejects.toThrow(
        'rate limit',
      );
    });
  });
});
```

### Integration Tests

```typescript
// tests/providers/solana-integration.test.ts
describe('Solana Provider Integration', () => {
  let providerManager: BlockchainProviderManager;

  beforeEach(() => {
    providerManager = new BlockchainProviderManager();
    providerManager.registerProviders('solana', [
      new SolanaRPCProvider(config),
      new QuickNodeSolanaProvider(config),
    ]);
  });

  it('should successfully failover between Solana providers', async () => {
    // Mock first provider failure
    jest
      .spyOn(SolanaRPCProvider.prototype, 'execute')
      .mockRejectedValueOnce(new Error('Service unavailable'));

    // Mock second provider success
    jest
      .spyOn(QuickNodeSolanaProvider.prototype, 'execute')
      .mockResolvedValueOnce([{ hash: 'success-tx' }]);

    const operation = {
      type: 'getAddressTransactions' as const,
      params: { address: 'test-address' },
    };

    const result = await providerManager.executeWithFailover(
      'solana',
      operation,
    );
    expect(result).toEqual([{ hash: 'success-tx' }]);
  });

  it('should respect Solana provider capabilities', async () => {
    const operation = {
      type: 'getStakingRewards' as const, // Not supported by basic provider
      params: { address: 'test-address' },
    };

    // Should skip providers that don't support this operation
    await expect(
      providerManager.executeWithFailover('solana', operation),
    ).rejects.toThrow('No providers support operation');
  });
});
```

## Step 5: Register and Deploy Provider

### Register with Provider Manager

```typescript
// src/adapters/blockchain/solana-adapter.ts
import { QuickNodeSolanaProvider } from '../../providers/QuickNodeSolanaProvider';
import { SolanaRPCProvider } from '../../providers/SolanaRPCProvider';
import { BaseBlockchainAdapter } from './base-blockchain-adapter';

export class SolanaAdapter extends BaseBlockchainAdapter {
  constructor(config: SolanaConfig) {
    super(config);

    // Register all Solana providers
    this.providerManager.registerProviders('solana', [
      new SolanaRPCProvider(config),
      new QuickNodeSolanaProvider(config),
      // Add more providers as needed
    ]);
  }

  protected getBlockchain(): string {
    return 'solana';
  }
}
```

### Update Adapter Factory

```typescript
// src/adapters/adapter-factory.ts
import { SolanaAdapter } from './blockchain/solana-adapter';

export function createBlockchainAdapter(options: BlockchainImportOptions): BlockchainAdapter {
  // ... existing code ...

    const blockchain = options.options.blockchain;

    switch (blockchain) {
      case 'bitcoin':
        return new BitcoinAdapter(options.options);
      case 'ethereum':
        return new EthereumAdapter(options.options);
      case 'injective':
        return new InjectiveAdapter(options.options);
      case 'solana':                                    // Add new case
        return new SolanaAdapter(options.options);
      default:
        throw new Error(`Unsupported blockchain: ${blockchain}`);
    }
  }

  // ... rest of factory logic ...
}
```

### Deploy Configuration

Add the new provider configuration to `config/blockchain-explorers.json`:

```json
{
  "solana": {
    "enabled": true,
    "options": {
      "blockchain": "solana",
      "providers": [
        {
          "name": "solana-rpc",
          "priority": 1,
          "enabled": true,
          "rateLimit": { "requestsPerSecond": 10 }
        }
      ]
    }
  }
}
```

## Advanced Provider Features

### Custom Capabilities

```typescript
export class AdvancedSolanaProvider implements IBlockchainProvider {
  readonly capabilities: ProviderCapabilities = {
    supportedOperations: [
      'getAddressTransactions',
      'getAddressBalance',
      'getTokenTransactions',
      'getStakingRewards', // Custom capability
      'getNFTTransactions', // Custom capability
    ],
    maxBatchSize: 100,
    providesHistoricalData: true,
    supportsPagination: true,
    supportsRealTimeData: true,
    supportsTokenData: true,
    // Custom capabilities
    supportsStaking: true,
    supportsNFTs: true,
  };

  async execute<T>(operation: ProviderOperation<T>): Promise<T> {
    switch (operation.type) {
      case 'getStakingRewards':
        return this.getStakingRewards(operation.params) as T;
      case 'getNFTTransactions':
        return this.getNFTTransactions(operation.params) as T;
      default:
        return super.execute(operation);
    }
  }
}
```

### Custom Caching Strategy

```typescript
export class CachedSolanaProvider extends SolanaRPCProvider {
  private cache = new Map<string, { data: any; expiry: number }>();

  async execute<T>(
    operation: ProviderOperation<T>,
    config: SolanaConfig,
  ): Promise<T> {
    // Check cache first for expensive operations
    if (operation.getCacheKey && this.shouldCache(operation.type)) {
      const cacheKey = operation.getCacheKey(operation.params);
      const cached = this.cache.get(cacheKey);

      if (cached && cached.expiry > Date.now()) {
        return cached.data;
      }
    }

    const result = await super.execute(operation, config);

    // Cache the result
    if (operation.getCacheKey) {
      const cacheKey = operation.getCacheKey(operation.params);
      this.cache.set(cacheKey, {
        data: result,
        expiry: Date.now() + this.getCacheTTL(operation.type),
      });
    }

    return result;
  }

  private shouldCache(operationType: string): boolean {
    // Cache expensive operations
    return ['getAddressTransactions', 'getTokenTransactions'].includes(
      operationType,
    );
  }

  private getCacheTTL(operationType: string): number {
    switch (operationType) {
      case 'getAddressTransactions':
        return 60000; // 1 minute
      case 'getAddressBalance':
        return 30000; // 30 seconds
      default:
        return 60000;
    }
  }
}
```

## Best Practices

### 1. Robust Error Handling

```typescript
// ✅ Good: Specific error types for different scenarios
private handleError(error: any): never {
  if (error.code === 429 || error.message?.includes('rate limit')) {
    throw new RateLimitError('Rate limit exceeded', { retryAfter: 60 });
  }

  if (error.code === 401 || error.code === 403) {
    throw new AuthenticationError('Invalid credentials');
  }

  if (error.code >= 500) {
    throw new ServiceUnavailableError('Service temporarily unavailable');
  }

  throw new Error(`Provider error: ${error.message}`);
}

// ❌ Bad: Generic error handling
private handleError(error: any): never {
  throw new Error(error.message);
}
```

### 2. Efficient Pagination

```typescript
// ✅ Good: Handle pagination efficiently
async getAllTransactions(address: string): Promise<BlockchainTransaction[]> {
  const allTransactions: BlockchainTransaction[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore && allTransactions.length < 10000) { // Prevent infinite loops
    const batch = await this.getTransactionBatch(address, cursor);
    allTransactions.push(...batch.transactions);

    cursor = batch.nextCursor;
    hasMore = batch.hasMore;

    // Rate limiting
    await this.delay(this.rateLimit.backoffMs || 100);
  }

  return allTransactions;
}
```

### 3. Proper Rate Limiting

```typescript
// ✅ Good: Respect rate limits
private async makeRateLimitedRequest(url: string, options: RequestInit): Promise<Response> {
  await this.rateLimiter.wait(); // Wait for rate limit clearance

  const response = await fetch(url, options);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
    await this.delay(retryAfter * 1000);
    return this.makeRateLimitedRequest(url, options); // Retry
  }

  return response;
}
```

### 4. Comprehensive Testing

```typescript
// ✅ Good: Test all edge cases
describe('Provider Edge Cases', () => {
  it('should handle empty transaction lists', async () => {
    // Mock empty response
    const result = await provider.execute(operation, config);
    expect(result).toEqual([]);
  });

  it('should handle malformed API responses gracefully', async () => {
    // Mock malformed response
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invalid: 'structure' }),
    });

    await expect(provider.execute(operation, config)).rejects.toThrow();
  });

  it('should respect timeout settings', async () => {
    // Mock slow response
    global.fetch = jest
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000)),
      );

    const configWithTimeout = { ...config, timeout: 1000 };
    await expect(
      provider.execute(operation, configWithTimeout),
    ).rejects.toThrow('timeout');
  });
});
```

## Common Pitfalls and Solutions

### Pitfall 1: Not Handling API Changes

```typescript
// ✅ Solution: Version-aware API handling
class VersionAwareSolanaProvider extends SolanaRPCProvider {
  private apiVersion: string;

  async testConnection(): Promise<boolean> {
    try {
      const response = await this.makeRequest('getVersion', []);
      this.apiVersion = response.result.version;
      return this.isVersionSupported(this.apiVersion);
    } catch {
      return false;
    }
  }

  private isVersionSupported(version: string): boolean {
    // Check if API version is compatible
    return semver.gte(version, '1.10.0');
  }
}
```

### Pitfall 2: Poor Resource Management

```typescript
// ✅ Solution: Proper cleanup and resource management
export class ResourceAwareSolanaProvider extends SolanaRPCProvider {
  private connections = new Set<AbortController>();

  async execute<T>(
    operation: ProviderOperation<T>,
    config: SolanaConfig,
  ): Promise<T> {
    const controller = new AbortController();
    this.connections.add(controller);

    try {
      const result = await this.makeRequest(operation, {
        signal: controller.signal,
      });
      return result;
    } finally {
      this.connections.delete(controller);
    }
  }

  async cleanup(): Promise<void> {
    // Cancel all pending requests
    for (const controller of this.connections) {
      controller.abort();
    }
    this.connections.clear();
  }
}
```

### Pitfall 3: Inconsistent Data Formats

```typescript
// ✅ Solution: Standardized data transformation
private transformTransaction(rawTx: any, address: string): BlockchainTransaction {
  // Always return consistent format regardless of source API
  return {
    hash: this.normalizeHash(rawTx.signature || rawTx.txid || rawTx.hash),
    blockNumber: this.normalizeBlockNumber(rawTx.slot || rawTx.block_height),
    timestamp: this.normalizeTimestamp(rawTx.blockTime || rawTx.timestamp),
    from: this.normalizeAddress(rawTx.from || rawTx.sender),
    to: this.normalizeAddress(rawTx.to || rawTx.recipient),
    value: this.normalizeAmount(rawTx.amount || rawTx.value),
    fee: this.normalizeAmount(rawTx.fee || rawTx.gas_used),
    status: this.normalizeStatus(rawTx.status || rawTx.err),
    raw: rawTx  // Always preserve original for debugging
  };
}
```

## Conclusion

Adding new providers to the Universal Blockchain Provider Architecture is a
systematic process that ensures consistency, reliability, and maintainability.
By following this guide, you can:

**✅ Implement Robust Providers**: Using established patterns and interfaces
**✅ Ensure Reliability**: With proper error handling and circuit breaker
integration **✅ Maintain Quality**: Through comprehensive testing and
validation **✅ Scale Effectively**: By following best practices for performance
and resource management

The modular design of the provider architecture means that each new provider you
add makes the entire system more resilient, providing additional failover
options and reducing single points of failure across all blockchain operations.
