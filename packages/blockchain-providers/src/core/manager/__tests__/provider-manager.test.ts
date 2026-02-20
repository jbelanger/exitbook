/**
 * Tests for BlockchainProviderManager — failover, circuit breaker,
 * capability routing, caching, and preferred-provider behaviour.
 */

import { type CursorState, type PaginationCursor } from '@exitbook/core';
import { type RateLimitConfig } from '@exitbook/http';
import { err, ok, okAsync, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { initializeProviders } from '../../../initialize.js';
import type { NormalizedTransactionBase } from '../../schemas/normalized-transaction.js';
import type { OneShotOperation, StreamingBatchResult, StreamingOperation } from '../../types/index.js';
import { ProviderError, type IBlockchainProvider, type ProviderCapabilities } from '../../types/index.js';
import { BlockchainProviderManager } from '../provider-manager.js';

// Mock explorer config for tests
const mockExplorerConfig = {};

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
    this.rateLimit = { requestsPerSecond: 1 };
    initializeProviders();
  }

  async execute<T>(operation: OneShotOperation): Promise<Result<T, Error>> {
    if (this.responseDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.responseDelay));
    }
    if (this.shouldFail) return err(new Error(`${this.name} provider failed`));
    switch (operation.type) {
      case 'getAddressBalances':
        return ok({ balance: 100, currency: 'ETH' } as T);
      default:
        return ok({ success: true } as T);
    }
  }

  async isHealthy(): Promise<Result<boolean, Error>> {
    if (this.shouldFail) return err(new Error('Mock provider is unhealthy'));
    return okAsync(true);
  }

  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    operation: StreamingOperation,
    _cursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    if (this.responseDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.responseDelay));
    }
    if (this.shouldFail) {
      yield err(new Error(`${this.name} provider failed`));
      return;
    }
    let data: T[];
    switch (operation.type) {
      case 'getAddressTransactions':
        data = [] as T[];
        break;
      default:
        data = [];
    }
    yield ok({
      data,
      providerName: this.name,
      cursor: {
        primary: { type: 'blockNumber' as const, value: 0 },
        lastTransactionId: '',
        totalFetched: data.length,
        metadata: { providerName: this.name, updatedAt: Date.now(), isComplete: true },
      },
    } as unknown as StreamingBatchResult<T>);
  }

  extractCursors(_transaction: unknown): PaginationCursor[] {
    return [];
  }

  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    return cursor;
  }

  async destroy(): Promise<void> {
    /* empty */
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

  afterEach(async () => {
    await manager.destroy();
  });

  test('should register providers successfully', () => {
    const providers = manager.getProviders('ethereum');
    expect(providers).toHaveLength(2);
    expect(providers[0]?.name).toBe('primary');
    expect(providers[1]?.name).toBe('fallback');
  });

  test('autoRegisterFromConfig is idempotent when providers already exist', () => {
    const registerSpy = vi.spyOn(manager, 'registerProviders');

    const existingProviders = manager.getProviders('ethereum');
    const result = manager.autoRegisterFromConfig('ethereum');

    expect(result).toBe(existingProviders);
    expect(registerSpy).not.toHaveBeenCalled();
    registerSpy.mockRestore();
  });

  test('should execute operations with primary provider', async () => {
    const operation: OneShotOperation = { address: '0x123', type: 'getAddressBalances' };
    const result = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.data.balance).toBe(100);
      expect(result.value.data.currency).toBe('ETH');
    }
  });

  test('should failover to secondary provider', async () => {
    primaryProvider.setFailureMode(true);
    const operation: OneShotOperation = { address: '0x123', type: 'getAddressBalances' };
    const result = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.data.balance).toBe(100);
    }
  });

  test('should fail when all providers fail', async () => {
    primaryProvider.setFailureMode(true);
    fallbackProvider.setFailureMode(true);
    const operation: OneShotOperation = { address: '0x123', type: 'getAddressBalances' };
    const result = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ProviderError);
      expect((result.error as ProviderError).code).toBe('ALL_PROVIDERS_FAILED');
      expect(result.error.message).toContain('All providers failed');
    }
  });

  test('should cache results when cache key provided', async () => {
    const operation: OneShotOperation = {
      address: '0x123',
      getCacheKey: (params) => `balance-${params.type === 'getAddressBalances' ? params.address : 'unknown'}`,
      type: 'getAddressBalances',
    };

    const result1 = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);

    // Kill both providers — should still return cached result
    primaryProvider.setFailureMode(true);
    fallbackProvider.setFailureMode(true);

    const result2 = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);
    expect(result2).toEqual(result1);
  });

  test('should provide health status', () => {
    const health = manager.getProviderHealth('ethereum');
    expect(health.size).toBe(2);
    expect(health.has('primary')).toBe(true);
    expect(health.has('fallback')).toBe(true);
    expect(health.get('primary')?.circuitState).toBe('closed');
  });

  test('should handle unsupported operations', async () => {
    const operation: OneShotOperation = { address: '0x123', type: 'getAddressTokenBalances' };
    const result = await manager.executeWithFailoverOnce<{ success: boolean }>(
      'ethereum',
      operation as OneShotOperation
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ProviderError);
      expect((result.error as ProviderError).code).toBe('NO_PROVIDERS');
      expect(result.error.message).toContain('No providers available');
    }
  });

  test('should respect circuit breaker state and skip dead providers', async () => {
    const executeSpyPrimary = vi.spyOn(primaryProvider, 'execute');
    const executeSpyFallback = vi.spyOn(fallbackProvider, 'execute');

    try {
      const operation: OneShotOperation = { address: '0x123', type: 'getAddressBalances' };

      primaryProvider.setFailureMode(true);
      await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);
      await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);
      await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);

      executeSpyPrimary.mockClear();
      executeSpyFallback.mockClear();
      primaryProvider.setFailureMode(false);

      const result = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>(
        'ethereum',
        operation
      );
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.data.balance).toBe(100);
      expect(executeSpyPrimary).not.toHaveBeenCalled();
      expect(executeSpyFallback).toHaveBeenCalledTimes(1);
    } finally {
      executeSpyPrimary.mockRestore();
      executeSpyFallback.mockRestore();
    }
  }, 5000);

  test('should route operations based on provider capabilities', async () => {
    const tokenProvider = new MockProvider('token-specialist', 'ethereum');
    tokenProvider.capabilities.supportedOperations = ['getAddressTransactions', 'getAddressTokenBalances'];
    tokenProvider.capabilities.supportedTransactionTypes = ['token'];

    const basicProvider = new MockProvider('basic-provider', 'ethereum');
    basicProvider.capabilities.supportedOperations = ['getAddressTransactions', 'getAddressBalances'];
    basicProvider.capabilities.supportedTransactionTypes = ['normal'];

    manager.registerProviders('ethereum', [basicProvider, tokenProvider]);

    const tokenExecuteSpy = vi.spyOn(tokenProvider, 'executeStreaming');
    const basicExecuteSpy = vi.spyOn(basicProvider, 'executeStreaming');

    const tokenOperation: StreamingOperation = {
      address: '0x123',
      contractAddress: '0xabc',
      type: 'getAddressTransactions',
      streamType: 'token',
    };

    for await (const _ of manager.executeWithFailover('ethereum', tokenOperation)) {
      break;
    }

    expect(tokenExecuteSpy).toHaveBeenCalledTimes(1);
    expect(basicExecuteSpy).not.toHaveBeenCalled();

    tokenExecuteSpy.mockRestore();
    basicExecuteSpy.mockRestore();
  });

  test('should handle cache expiration correctly', async () => {
    vi.useFakeTimers();

    const operation: OneShotOperation = {
      address: '0x123',
      getCacheKey: (params) => `balance-${params.type === 'getAddressBalances' ? params.address : 'unknown'}`,
      type: 'getAddressBalances',
    };

    const result1 = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);
    expect(result1.isOk()).toBe(true);

    vi.advanceTimersByTime(35000); // advance past 30s cache TTL

    primaryProvider.setFailureMode(true);

    const result2 = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', operation);
    expect(result2.isOk()).toBe(true);
    if (result2.isOk()) expect(result2.value.data.balance).toBe(100); // from fallback, not stale cache

    vi.useRealTimers();
  });
});

describe('BlockchainProviderManager lifecycle', () => {
  test('does not start background timers in constructor', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const manager = new BlockchainProviderManager(mockExplorerConfig);

    try {
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      await manager.destroy();
      setIntervalSpy.mockRestore();
    }
  });

  test('starts background timers only once when called repeatedly', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const manager = new BlockchainProviderManager(mockExplorerConfig);

    try {
      manager.startBackgroundTasks();
      manager.startBackgroundTasks();
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    } finally {
      await manager.destroy();
      setIntervalSpy.mockRestore();
    }
  });

  test('uses registration blockchain for provider health lookup', async () => {
    const manager = new BlockchainProviderManager(mockExplorerConfig);
    const mismatchedProvider = new MockProvider('mismatch', 'base');

    try {
      manager.registerProviders('ethereum', [mismatchedProvider]);

      const operation: OneShotOperation = { address: '0x123', type: 'getAddressBalances' };
      const result = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>(
        'ethereum',
        operation
      );
      expect(result.isOk()).toBe(true);

      const health = manager.getProviderHealth('ethereum');
      expect(health.has('mismatch')).toBe(true);
      expect(manager.getProviderHealth('base').size).toBe(0);
    } finally {
      await manager.destroy();
    }
  });
});

describe('Provider System Integration', () => {
  test('should handle complete provider lifecycle', async () => {
    const manager = new BlockchainProviderManager(mockExplorerConfig);
    const provider = new MockProvider('test', 'bitcoin');

    try {
      manager.registerProviders('bitcoin', [provider]);

      const operation: StreamingOperation = { address: 'bc1xyz', type: 'getAddressTransactions' };

      for await (const batchResult of manager.executeWithFailover<{
        address: string;
        transactions: unknown[];
      }>('bitcoin', operation)) {
        expect(batchResult.isOk()).toBe(true);
        if (batchResult.isOk()) {
          expect(batchResult.value.data).toEqual([]);
          expect(batchResult.value.providerName).toBe('test');
        }
        break;
      }

      const health = manager.getProviderHealth('bitcoin');
      const providerHealth = health.get('test');
      expect(providerHealth?.isHealthy).toBe(true);
      expect(providerHealth?.circuitState).toBe('closed');
    } finally {
      await manager.destroy();
    }
  });

  test('should auto-register providers from configuration', async () => {
    const { ProviderRegistry } = await import('../../registry/provider-registry.js');
    const manager = new BlockchainProviderManager(mockExplorerConfig);

    try {
      const metadata = ProviderRegistry.getMetadata('ethereum', 'moralis')!;
      const testConfig = {
        ...metadata.defaultConfig,
        baseUrl: metadata.baseUrl,
        blockchain: 'ethereum',
        displayName: metadata.displayName,
        name: metadata.name,
        requiresApiKey: metadata.requiresApiKey,
      };

      const provider = ProviderRegistry.createProvider('ethereum', 'moralis', testConfig);
      manager.registerProviders('ethereum', [provider]);

      const registeredProviders = manager.getProviders('ethereum');
      expect(registeredProviders.length).toBe(1);
      expect(registeredProviders[0]?.name).toBe('moralis');
    } finally {
      await manager.destroy();
    }
  });
});

describe('Preferred Provider Behavior', () => {
  let manager: BlockchainProviderManager;
  let routescanProvider: MockProvider;
  let moralisProvider: MockProvider;

  beforeEach(() => {
    manager = new BlockchainProviderManager(mockExplorerConfig);

    routescanProvider = new MockProvider('routescan', 'ethereum');
    routescanProvider.capabilities.supportedOperations = ['getAddressTransactions', 'getAddressBalances'];

    moralisProvider = new MockProvider('moralis', 'ethereum');
    moralisProvider.capabilities.supportedOperations = [
      'getAddressTransactions',
      'getAddressBalances',
      'getAddressTokenBalances',
      'getTokenMetadata',
    ];
  });

  afterEach(async () => {
    await manager.destroy();
  });

  test('should use ONLY preferred provider when it supports the operation', async () => {
    manager.registerProviders('ethereum', [routescanProvider, moralisProvider]);
    (manager as unknown as { preferredProviders: Map<string, string> }).preferredProviders.set('ethereum', 'routescan');

    const executeSpyRoutescan = vi.spyOn(routescanProvider, 'execute');
    const executeSpyMoralis = vi.spyOn(moralisProvider, 'execute');

    const result = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', {
      address: '0x123',
      type: 'getAddressBalances',
    });

    expect(result.isOk()).toBe(true);
    expect(executeSpyRoutescan).toHaveBeenCalledTimes(1);
    expect(executeSpyMoralis).not.toHaveBeenCalled();

    executeSpyRoutescan.mockRestore();
    executeSpyMoralis.mockRestore();
  });

  test('should failover to other providers when preferred provider does NOT support the operation', async () => {
    manager.registerProviders('ethereum', [routescanProvider, moralisProvider]);
    (manager as unknown as { preferredProviders: Map<string, string> }).preferredProviders.set('ethereum', 'routescan');

    const executeSpyRoutescan = vi.spyOn(routescanProvider, 'execute');
    const executeSpyMoralis = vi.spyOn(moralisProvider, 'execute');

    const result = await manager.executeWithFailoverOnce<{ success: boolean }>('ethereum', {
      type: 'getTokenMetadata',
      contractAddresses: ['0xabc'],
    });

    expect(result.isOk()).toBe(true);
    expect(executeSpyRoutescan).not.toHaveBeenCalled();
    expect(executeSpyMoralis).toHaveBeenCalledTimes(1);

    executeSpyRoutescan.mockRestore();
    executeSpyMoralis.mockRestore();
  });

  test('should NOT failover when preferred provider fails but supports the operation', async () => {
    manager.registerProviders('ethereum', [routescanProvider, moralisProvider]);
    (manager as unknown as { preferredProviders: Map<string, string> }).preferredProviders.set('ethereum', 'routescan');

    routescanProvider.setFailureMode(true);

    const executeSpyRoutescan = vi.spyOn(routescanProvider, 'execute');
    const executeSpyMoralis = vi.spyOn(moralisProvider, 'execute');

    const result = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', {
      address: '0x123',
      type: 'getAddressBalances',
    });

    expect(result.isErr()).toBe(true);
    expect(executeSpyRoutescan).toHaveBeenCalledTimes(1);
    expect(executeSpyMoralis).not.toHaveBeenCalled();

    executeSpyRoutescan.mockRestore();
    executeSpyMoralis.mockRestore();
  });

  test('should use normal provider selection when no preferred provider is set', async () => {
    manager.registerProviders('ethereum', [routescanProvider, moralisProvider]);

    const executeSpyRoutescan = vi.spyOn(routescanProvider, 'execute');

    const result = await manager.executeWithFailoverOnce<{ balance: number; currency: string }>('ethereum', {
      address: '0x123',
      type: 'getAddressBalances',
    });

    expect(result.isOk()).toBe(true);
    expect(executeSpyRoutescan).toHaveBeenCalled();

    executeSpyRoutescan.mockRestore();
  });

  test('should handle streaming operations with preferred provider', async () => {
    manager.registerProviders('ethereum', [routescanProvider, moralisProvider]);
    (manager as unknown as { preferredProviders: Map<string, string> }).preferredProviders.set('ethereum', 'routescan');

    const executeStreamingSpyRoutescan = vi.spyOn(routescanProvider, 'executeStreaming');
    const executeStreamingSpyMoralis = vi.spyOn(moralisProvider, 'executeStreaming');

    for await (const batchResult of manager.executeWithFailover('ethereum', {
      address: '0x123',
      type: 'getAddressTransactions',
    })) {
      expect(batchResult.isOk()).toBe(true);
      break;
    }

    expect(executeStreamingSpyRoutescan).toHaveBeenCalledTimes(1);
    expect(executeStreamingSpyMoralis).not.toHaveBeenCalled();

    executeStreamingSpyRoutescan.mockRestore();
    executeStreamingSpyMoralis.mockRestore();
  });
});
