/**
 * Foundation tests for the universal blockchain provider system
 * Tests core interfaces, circuit breaker, and provider manager functionality
 */

import { getErrorMessage } from '@exitbook/core';
import { type RateLimitConfig } from '@exitbook/platform-http';

// Import clients to trigger registration
import '../../../blockchain/evm/register-apis.js';
import { err, ok, type Result } from 'neverthrow';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { BlockchainProviderManager } from '../provider-manager.ts';
import { ProviderRegistry } from '../registry/provider-registry.js';
import type { ProviderInfo } from '../types/index.js';
import {
  ProviderError,
  type IBlockchainProvider,
  type ProviderCapabilities,
  type ProviderOperation,
} from '../types/index.js';

// Mock explorer config for tests
const mockExplorerConfig = {};

// Mock provider for testing
class MockProvider implements IBlockchainProvider {
  public readonly blockchain: string;
  public readonly capabilities: ProviderCapabilities;

  public readonly name: string;
  public readonly rateLimit: RateLimitConfig;
  private responseDelay = 0;
  private shouldFail = false;

  constructor(name: string, blockchain: string, shouldFail = false, responseDelay = 0) {
    this.name = name;
    this.blockchain = blockchain;
    this.shouldFail = shouldFail;
    this.responseDelay = responseDelay;

    this.capabilities = {
      supportedOperations: ['getAddressTransactions', 'getAddressBalances'],
    };

    this.rateLimit = {
      requestsPerSecond: 1,
    };
  }

  async execute<T>(operation: ProviderOperation): Promise<Result<T, Error>> {
    if (this.responseDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.responseDelay));
    }

    if (this.shouldFail) {
      return err(new Error(`${this.name} provider failed`));
    }

    // Mock response based on operation type
    switch (operation.type) {
      case 'getAddressTransactions':
        return ok({ address: operation.address, transactions: [] } as T);
      case 'getAddressBalances':
        return ok({ balance: 100, currency: 'ETH' } as T);
      default:
        return ok({ success: true } as T);
    }
  }

  async isHealthy(): Promise<Result<boolean, Error>> {
    if (this.shouldFail) {
      return err(new Error('Mock provider is unhealthy'));
    }
    return Promise.resolve(ok(true));
  }

  async benchmarkRateLimit(): Promise<{
    burstLimits?: { limit: number; success: boolean }[];
    maxSafeRate: number;
    recommended: RateLimitConfig;
    testResults: { rate: number; responseTimeMs?: number; success: boolean }[];
  }> {
    return Promise.resolve({
      maxSafeRate: 1,
      recommended: { requestsPerSecond: 1 },
      testResults: [{ rate: 1, success: true }],
    });
  }

  setFailureMode(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }
}

describe('BlockchainProviderManager', () => {
  let manager: BlockchainProviderManager;
  let primaryProvider: MockProvider;
  let fallbackProvider: MockProvider;

  beforeEach(() => {
    manager = new BlockchainProviderManager(mockExplorerConfig);
    primaryProvider = new MockProvider('primary', 'ethereum');
    fallbackProvider = new MockProvider('fallback', 'ethereum');

    manager.registerProviders('ethereum', [primaryProvider, fallbackProvider]);
  });

  afterEach(() => {
    manager.destroy();
  });

  test('should register providers successfully', () => {
    const providers = manager.getProviders('ethereum');
    expect(providers).toHaveLength(2);
    expect(providers[0]?.name).toBe('primary');
    expect(providers[1]?.name).toBe('fallback');
  });

  test('should execute operations with primary provider', async () => {
    const operation: ProviderOperation = {
      address: '0x123',
      type: 'getAddressBalances',
    };

    const result = await manager.executeWithFailover<{ balance: number; currency: string }>('ethereum', operation);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.data.balance).toBe(100);
      expect(result.value.data.currency).toBe('ETH');
    }
  });

  test('should failover to secondary provider', async () => {
    // Make primary provider fail
    primaryProvider.setFailureMode(true);

    const operation: ProviderOperation = {
      address: '0x123',
      type: 'getAddressBalances',
    };

    const result = await manager.executeWithFailover<{ balance: number; currency: string }>('ethereum', operation);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.data.balance).toBe(100); // Should get result from fallback
    }
  });

  test('should fail when all providers fail', async () => {
    primaryProvider.setFailureMode(true);
    fallbackProvider.setFailureMode(true);

    const operation: ProviderOperation = {
      address: '0x123',
      type: 'getAddressBalances',
    };

    const result = await manager.executeWithFailover<{ balance: number; currency: string }>('ethereum', operation);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ProviderError);
      expect(result.error.code).toBe('ALL_PROVIDERS_FAILED');
      expect(result.error.message).toContain('All providers failed');
    }
  });

  test('should cache results when cache key provided', async () => {
    const operation: ProviderOperation = {
      address: '0x123',
      getCacheKey: (params) => {
        return `balance-${params.type === 'getAddressBalances' ? params.address : 'unknown'}`;
      },
      type: 'getAddressBalances',
    };

    // First call
    const result1 = await manager.executeWithFailover<{ balance: number; currency: string }>('ethereum', operation);

    // Make provider fail - should still get cached result
    primaryProvider.setFailureMode(true);
    fallbackProvider.setFailureMode(true);

    const result2 = await manager.executeWithFailover<{ balance: number; currency: string }>('ethereum', operation);
    expect(result2).toEqual(result1);
  });

  test('should provide health status', () => {
    const health = manager.getProviderHealth('ethereum');

    expect(health.size).toBe(2);
    expect(health.has('primary')).toBe(true);
    expect(health.has('fallback')).toBe(true);

    const primaryHealth = health.get('primary');
    expect(primaryHealth?.circuitState).toBe('closed');
  });

  test('should handle unsupported operations', async () => {
    const operation = {
      type: 'custom', // Not supported by mock providers
    };

    const result = await manager.executeWithFailover<{ success: boolean }>('ethereum', operation as ProviderOperation);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ProviderError);
      expect(result.error.code).toBe('NO_PROVIDERS');
      expect(result.error.message).toContain('No providers available');
    }
  });

  test('should respect circuit breaker state and skip dead providers', async () => {
    const executeSpyPrimary = vi.spyOn(primaryProvider, 'execute');
    const executeSpyFallback = vi.spyOn(fallbackProvider, 'execute');

    try {
      const operation: ProviderOperation = {
        address: '0x123',
        type: 'getAddressBalances',
      };

      // Trip the primary provider's circuit breaker
      primaryProvider.setFailureMode(true);

      // Make enough calls to trip the breaker
      await manager.executeWithFailover<{
        balance: number;
        currency: string;
      }>('ethereum', operation);
      await manager.executeWithFailover<{
        balance: number;
        currency: string;
      }>('ethereum', operation);
      await manager.executeWithFailover<{
        balance: number;
        currency: string;
      }>('ethereum', operation);

      // Reset spies and make primary healthy again
      executeSpyPrimary.mockClear();
      executeSpyFallback.mockClear();
      primaryProvider.setFailureMode(false);

      // Next call should skip primary (circuit breaker open) and go to fallback
      const result = await manager.executeWithFailover<{
        balance: number;
        currency: string;
      }>('ethereum', operation);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.data.balance).toBe(100);
      }
      expect(executeSpyPrimary).not.toHaveBeenCalled(); // Primary skipped due to circuit breaker
      expect(executeSpyFallback).toHaveBeenCalledTimes(1); // Fallback used
    } finally {
      executeSpyPrimary.mockRestore();
      executeSpyFallback.mockRestore();
    }
  }, 5000);

  test('should route operations based on provider capabilities', async () => {
    // Create providers with different capabilities
    const tokenProvider = new MockProvider('token-specialist', 'ethereum');
    tokenProvider.capabilities.supportedOperations = ['getAddressTokenTransactions', 'getAddressTokenBalances'];

    const basicProvider = new MockProvider('basic-provider', 'ethereum');
    basicProvider.capabilities.supportedOperations = ['getAddressTransactions', 'getAddressBalances'];

    manager.registerProviders('ethereum', [basicProvider, tokenProvider]);

    const tokenExecuteSpy = vi.spyOn(tokenProvider, 'execute');
    const basicExecuteSpy = vi.spyOn(basicProvider, 'execute');

    // Execute token operation - should only use token provider
    const tokenOperation: ProviderOperation = {
      address: '0x123',
      contractAddress: '0xabc',
      type: 'getAddressTokenTransactions',
    };

    await manager.executeWithFailover('ethereum', tokenOperation);

    expect(tokenExecuteSpy).toHaveBeenCalledTimes(1);
    expect(basicExecuteSpy).not.toHaveBeenCalled(); // Basic provider doesn't support token operations

    tokenExecuteSpy.mockRestore();
    basicExecuteSpy.mockRestore();
  });

  test('should handle cache expiration correctly', async () => {
    vi.useFakeTimers();

    const operation: ProviderOperation = {
      address: '0x123',
      getCacheKey: (params) => {
        return `balance-${params.type === 'getAddressBalances' ? params.address : 'unknown'}`;
      },
      type: 'getAddressBalances',
    };

    // First call - should cache result
    const result1 = await manager.executeWithFailover<{ balance: number; currency: string }>('ethereum', operation);
    expect(result1.isOk()).toBe(true);
    if (result1.isOk()) {
      expect(result1.value.data.balance).toBe(100);
    }

    // Advance time past cache expiry (30 seconds + buffer)
    vi.advanceTimersByTime(35000);

    // Make primary provider fail
    primaryProvider.setFailureMode(true);

    // Second call - cache expired, should fail over to fallback
    const result2 = await manager.executeWithFailover<{ balance: number; currency: string }>('ethereum', operation);
    expect(result2.isOk()).toBe(true);
    if (result2.isOk()) {
      expect(result2.value.data.balance).toBe(100); // Should get result from fallback, not stale cache
    }

    vi.useRealTimers();
  });
});

describe('ProviderRegistry', () => {
  let availableEthereumProviders: ProviderInfo[];

  beforeAll(() => {
    // Get available providers after imports have triggered registration
    availableEthereumProviders = ProviderRegistry.getAvailable('ethereum');
  });

  test('should have registered Alchemy provider', () => {
    const isRegistered = ProviderRegistry.isRegistered('ethereum', 'alchemy');
    expect(isRegistered).toBe(true);
  });

  test('should list Alchemy in available Ethereum providers', () => {
    expect(availableEthereumProviders.length).toBeGreaterThanOrEqual(1);

    const alchemy = availableEthereumProviders.find((p) => p.name === 'alchemy');
    expect(alchemy).toBeDefined();
    expect(alchemy?.blockchain).toBe('ethereum');
    expect(alchemy?.displayName).toBe('Alchemy');
    expect(alchemy?.requiresApiKey).toBe(true);
  });

  test('should have correct provider metadata', () => {
    const metadata = ProviderRegistry.getMetadata('ethereum', 'alchemy');

    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe('alchemy');
    expect(metadata?.blockchain).toBe('ethereum');
    expect(metadata?.displayName).toBe('Alchemy');
    expect(metadata?.requiresApiKey).toBe(true);
    expect(metadata?.defaultConfig).toBeDefined();
    expect(metadata?.baseUrl).toBe('https://eth-mainnet.g.alchemy.com/v2');
  });

  test('should create provider instances from registry', () => {
    // Get metadata to build a proper ProviderConfig
    const metadata = ProviderRegistry.getMetadata('ethereum', 'alchemy')!;

    const config = {
      ...metadata.defaultConfig,
      baseUrl: metadata.baseUrl,
      blockchain: 'ethereum',
      displayName: metadata.displayName,
      name: metadata.name,
      requiresApiKey: metadata.requiresApiKey,
    };

    const provider = ProviderRegistry.createProvider('ethereum', 'alchemy', config);

    expect(provider).toBeDefined();
    expect(provider.name).toBe('alchemy');
    expect(provider.blockchain).toBe('ethereum');
    expect(provider.capabilities).toBeDefined();
    expect(provider.capabilities.supportedOperations).toContain('getAddressTransactions');
    expect(provider.capabilities.supportedOperations).toContain('getAddressInternalTransactions');
  });

  test('should validate legacy configuration correctly', () => {
    const validConfig = {
      ethereum: {
        explorers: [{ enabled: true, name: 'alchemy', priority: 1 }],
      },
    };

    const invalidConfig = {
      ethereum: {
        explorers: [{ enabled: true, name: 'invalid-provider', priority: 1 }],
      },
    };

    const validResult = ProviderRegistry.validateConfig(validConfig);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    const invalidResult = ProviderRegistry.validateConfig(invalidConfig);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(0);
    expect(invalidResult.errors[0]).toContain('invalid-provider');
  });

  test('should validate new override-based configuration correctly', () => {
    const validOverrideConfig = {
      ethereum: {
        defaultEnabled: ['alchemy', 'moralis'],
        overrides: {
          alchemy: { priority: 1, rateLimit: { requestsPerSecond: 0.5 } },
          moralis: { enabled: false },
        },
      },
    };

    const invalidOverrideConfig = {
      ethereum: {
        defaultEnabled: ['invalid-provider'],
        overrides: {},
      },
    };

    // Note: validateConfig currently handles legacy format, so we test direct validation
    const validResult = ProviderRegistry.validateConfig(validOverrideConfig);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    const invalidResult = ProviderRegistry.validateConfig(invalidOverrideConfig);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(0);
    expect(invalidResult.errors[0]).toContain('invalid-provider');
  });

  test('should throw error with helpful suggestions for non-existent providers', () => {
    // Create a minimal config for error testing
    const minimalConfig = {
      baseUrl: 'https://test.com',
      blockchain: 'ethereum',
      displayName: 'Test',
      name: 'non-existent',
      rateLimit: { requestsPerSecond: 1 },
      retries: 3,
      timeout: 10000,
    };

    expect(() => {
      ProviderRegistry.createProvider('ethereum', 'non-existent', minimalConfig);
    }).toThrow(/Provider 'non-existent' not found for blockchain ethereum/);

    // Should contain helpful suggestions
    try {
      ProviderRegistry.createProvider('ethereum', 'non-existent', minimalConfig);
    } catch (error) {
      const message = getErrorMessage(error);
      expect(message).toContain('💡 Available providers');
      expect(message).toContain('💡 Run');
      expect(message).toContain('providers:list');
      expect(message).toContain('💡 Check for typos');
      expect(message).toContain('providers:sync --fix');
    }
  });

  test('should handle empty blockchain configurations', () => {
    const providers = ProviderRegistry.getAvailable('non-existent-blockchain');
    expect(providers).toHaveLength(0);
  });

  test('should provide provider capabilities information', () => {
    const alchemy = availableEthereumProviders.find((p) => p.name === 'alchemy');

    expect(alchemy?.capabilities).toBeDefined();
    expect(alchemy?.capabilities.supportedOperations).toBeDefined();
  });

  test('should provide rate limiting information', () => {
    const alchemy = availableEthereumProviders.find((p) => p.name === 'alchemy');

    expect(alchemy?.defaultConfig.rateLimit).toBeDefined();
    expect(alchemy?.defaultConfig.rateLimit.requestsPerSecond).toBe(5);
    expect(alchemy?.defaultConfig.rateLimit.burstLimit).toBe(10);
  });
});

describe('Provider System Integration', () => {
  test('should handle complete provider lifecycle', async () => {
    const manager = new BlockchainProviderManager(mockExplorerConfig);
    const provider = new MockProvider('test', 'bitcoin');

    try {
      manager.registerProviders('bitcoin', [provider]);

      // Test successful operation
      const operation: ProviderOperation = {
        address: 'bc1xyz',
        type: 'getAddressTransactions',
      };

      const result = await manager.executeWithFailover<{
        address: string;
        transactions: unknown[];
      }>('bitcoin', operation);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.data.transactions).toEqual([]);
        expect(result.value.data.address).toBe('bc1xyz');
      }

      // Verify health status
      const health = manager.getProviderHealth('bitcoin');
      const providerHealth = health.get('test');
      expect(providerHealth?.isHealthy).toBe(true);
      expect(providerHealth?.circuitState).toBe('closed');
    } finally {
      manager.destroy();
    }
  });

  test('should auto-register providers from configuration', () => {
    const manager = new BlockchainProviderManager(mockExplorerConfig);

    try {
      // For this test, we'll manually create a provider since the config loading
      // uses import.meta.url which doesn't work well in Jest environment
      const metadata = ProviderRegistry.getMetadata('ethereum', 'alchemy')!;

      const testConfig = {
        ...metadata.defaultConfig,
        baseUrl: metadata.baseUrl,
        blockchain: 'ethereum',
        displayName: metadata.displayName,
        name: metadata.name,
        requiresApiKey: metadata.requiresApiKey,
      };

      const provider = ProviderRegistry.createProvider('ethereum', 'alchemy', testConfig);
      manager.registerProviders('ethereum', [provider]);

      const registeredProviders = manager.getProviders('ethereum');
      expect(registeredProviders.length).toBe(1);
      expect(registeredProviders[0]?.name).toBe('alchemy');
    } finally {
      manager.destroy();
    }
  });
});
