import type { IExchangeClient, BalanceSnapshot } from '@exitbook/exchanges';
import type { BlockchainProviderManager } from '@exitbook/providers';
import { ok } from 'neverthrow';
import { vi, type Mocked } from 'vitest';

import type { ITokenMetadataService } from '../../services/token-metadata/token-metadata-service.interface.js';
import type { IRawDataRepository, IDataSourceRepository } from '../../types/repositories.js';

/**
 * Creates a mock raw data repository with default implementations.
 * All methods return successful Results by default. Override specific methods as needed.
 */
export function createMockRawDataRepository(): Mocked<IRawDataRepository> {
  return {
    saveBatch: vi.fn().mockResolvedValue(ok(0)),
    save: vi.fn().mockResolvedValue(ok(1)),
    load: vi.fn().mockResolvedValue(ok([])),
    // eslint-disable-next-line unicorn/no-null -- Repository interface requires null for no cursor
    getLatestCursor: vi.fn().mockResolvedValue(ok(null)),
    markAsProcessed: vi.fn().mockResolvedValue(ok()),
    getValidRecords: vi.fn().mockResolvedValue(ok([])),
  } as unknown as Mocked<IRawDataRepository>;
}

/**
 * Creates a mock data source repository with default implementations.
 * All methods return successful Results by default. Override specific methods as needed.
 */
export function createMockDataSourceRepository(): Mocked<IDataSourceRepository> {
  return {
    create: vi.fn().mockResolvedValue(ok(1)),
    finalize: vi.fn().mockResolvedValue(ok()),
    findAll: vi.fn().mockResolvedValue(ok([])),
    findById: vi.fn().mockResolvedValue(ok()),
    findBySource: vi.fn().mockResolvedValue(ok([])),
    update: vi.fn().mockResolvedValue(ok()),
    findCompletedWithMatchingParams: vi.fn().mockResolvedValue(ok()),
    updateVerificationMetadata: vi.fn().mockResolvedValue(ok()),
    deleteBySource: vi.fn().mockResolvedValue(ok()),
    deleteAll: vi.fn().mockResolvedValue(ok()),
  } as unknown as Mocked<IDataSourceRepository>;
}

/**
 * Creates a mock token metadata service with default implementations.
 * Returns successful results by default. Override specific methods as needed.
 */
export function createMockTokenMetadataService(): Mocked<ITokenMetadataService> {
  return {
    enrichBatch: vi.fn().mockResolvedValue(ok()),
    getOrFetch: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as Mocked<ITokenMetadataService>;
}

/**
 * Creates a mock BlockchainProviderManager with default implementations.
 * Provides a single mock provider for the specified blockchain.
 *
 * @param blockchain - The blockchain identifier (e.g., 'ethereum', 'solana', 'bitcoin')
 */
export function createMockProviderManager(
  blockchain: string
): Mocked<Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>> {
  const mockProviderManager = {
    autoRegisterFromConfig: vi.fn<BlockchainProviderManager['autoRegisterFromConfig']>(),
    executeWithFailover: vi.fn<BlockchainProviderManager['executeWithFailover']>(),
    getProviders: vi.fn<BlockchainProviderManager['getProviders']>(),
  } as unknown as Mocked<
    Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
  >;

  mockProviderManager.autoRegisterFromConfig.mockReturnValue([]);
  mockProviderManager.getProviders.mockReturnValue([
    {
      name: 'mock-provider',
      blockchain,
      benchmarkRateLimit: vi.fn().mockResolvedValue({
        maxSafeRate: 1,
        recommended: { maxRequestsPerSecond: 1 },
        testResults: [],
      }),
      capabilities: { supportedOperations: [] },
      execute: vi.fn(),
      isHealthy: vi.fn().mockResolvedValue(true),
      rateLimit: { requestsPerSecond: 1 },
    },
  ]);

  return mockProviderManager;
}

/**
 * Creates a mock exchange client with default implementations.
 *
 * @param exchangeId - The exchange identifier (e.g., 'kraken', 'kucoin')
 * @param mockBalance - Optional mock balance snapshot to return from fetchBalance
 */
export function createMockExchangeClient(exchangeId: string, mockBalance?: BalanceSnapshot): Mocked<IExchangeClient> {
  const defaultBalance: BalanceSnapshot = mockBalance ?? {
    balances: {},
    timestamp: Date.now(),
  };

  return {
    exchangeId,
    fetchBalance: vi.fn().mockResolvedValue(ok(defaultBalance)),
    fetchTransactionData: vi.fn().mockResolvedValue(ok([])),
  } as unknown as Mocked<IExchangeClient>;
}

/**
 * Creates a mock logger that can be used to replace @exitbook/shared-logger.
 * Useful for vi.mock() calls.
 */
export function createMockLogger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
}
