import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { PaginationCursor } from '@exitbook/core';
import type { IExchangeClient, BalanceSnapshot } from '@exitbook/exchanges-providers';
import { errAsync, ok } from 'neverthrow';
import { vi, type Mocked } from 'vitest';

import type { ITokenMetadataService } from '../../services/token-metadata/token-metadata-service.interface.js';
import type { IRawDataRepository, IImportSessionRepository } from '../../types/repositories.js';

/**
 * Creates a mock raw data repository with default implementations.
 * All methods return successful Results by default. Override specific methods as needed.
 */
export function createMockRawDataRepository(): Mocked<IRawDataRepository> {
  return {
    load: vi.fn().mockResolvedValue(ok([])),
    markAsProcessed: vi.fn().mockResolvedValue(ok()),
    save: vi.fn().mockResolvedValue(ok(1)),
    saveBatch: vi.fn().mockResolvedValue(ok(0)),
    getValidRecords: vi.fn().mockResolvedValue(ok([])),
    resetProcessingStatusByAccount: vi.fn().mockResolvedValue(ok(0)),
    resetProcessingStatusAll: vi.fn().mockResolvedValue(ok(0)),
    countAll: vi.fn().mockResolvedValue(ok(0)),
    countByAccount: vi.fn().mockResolvedValue(ok(0)),
    deleteByAccount: vi.fn().mockResolvedValue(ok(0)),
    deleteAll: vi.fn().mockResolvedValue(ok(0)),
  } as unknown as Mocked<IRawDataRepository>;
}

/**
 * Creates a mock import session repository with default implementations.
 * All methods return successful Results by default. Override specific methods as needed.
 */
export function createMockDataSourceRepository(): Mocked<IImportSessionRepository> {
  return {
    create: vi.fn().mockResolvedValue(ok(1)),
    finalize: vi.fn().mockResolvedValue(ok()),
    findAll: vi.fn().mockResolvedValue(ok([])),
    findById: vi.fn().mockResolvedValue(ok()),
    findByAccount: vi.fn().mockResolvedValue(ok([])),
    findByAccounts: vi.fn().mockResolvedValue(ok([])),
    getDataSourceIdsByAccounts: vi.fn().mockResolvedValue(ok([])),
    getSessionCountsByAccount: vi.fn().mockResolvedValue(ok(new Map())),
    findLatestIncomplete: vi.fn().mockResolvedValue(ok(undefined)),
    update: vi.fn().mockResolvedValue(ok()),
    countAll: vi.fn().mockResolvedValue(ok(0)),
    countByAccount: vi.fn().mockResolvedValue(ok(0)),
    deleteByAccount: vi.fn().mockResolvedValue(ok()),
    deleteAll: vi.fn().mockResolvedValue(ok()),
  } as unknown as Mocked<IImportSessionRepository>;
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
 * The executeWithFailover method returns an async iterator by default.
 * Override it in tests to provide specific behavior:
 * ```
 * mockProviderManager.executeWithFailover.mockImplementation(async function* () {
 *   yield ok({ data: [...], providerName: '...', cursor: {...} });
 * });
 * ```
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

  // Default implementation: returns empty async iterator
  mockProviderManager.executeWithFailover.mockImplementation(async function* () {
    // By default, yield nothing. Tests should override this.
  });

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
      executeStreaming: vi.fn(async function* () {
        yield errAsync(new Error('Streaming not implemented in mock'));
      }),
      extractCursors: vi.fn((_transaction: unknown): PaginationCursor[] => []),
      applyReplayWindow: vi.fn((cursor: PaginationCursor): PaginationCursor => cursor),
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
 * Creates a mock logger that can be used to replace @exitbook/logger.
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
