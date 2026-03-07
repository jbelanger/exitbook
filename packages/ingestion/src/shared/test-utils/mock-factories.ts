import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { PaginationCursor } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import type { IExchangeClient, BalanceSnapshot } from '@exitbook/exchange-providers';
import { vi, type Mocked } from 'vitest';

import type { IImportSessionLookup } from '../../ports/import-session-guard.js';
import type { IProcessingBatchSource } from '../../ports/processing-batch-source.js';

/**
 * Creates a mock IProcessingBatchSource with default implementations.
 * All methods return successful Results by default. Override specific methods as needed.
 */
/**
 * Creates a passthrough withTransaction for mock ports.
 * In tests, atomicity doesn't matter — just call the function with the same ports.
 */
export function mockWithTransaction<T extends { withTransaction: unknown }>(ports: T): T {
  (ports as Record<string, unknown>)['withTransaction'] = vi
    .fn()
    .mockImplementation((fn: (txPorts: T) => Promise<unknown>) => fn(ports));
  return ports;
}

export function createMockBatchSource(): Mocked<IProcessingBatchSource> {
  return {
    findAccountsWithRawData: vi.fn().mockResolvedValue(ok([])),
    findAccountsWithPendingData: vi.fn().mockResolvedValue(ok([])),
    countPending: vi.fn().mockResolvedValue(ok(0)),
    countPendingByStreamType: vi.fn().mockResolvedValue(ok(new Map())),
    fetchAllPending: vi.fn().mockResolvedValue(ok([])),
    fetchPendingByTransactionHash: vi.fn().mockResolvedValue(ok([])),
    markProcessed: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

/**
 * Creates a mock IImportSessionLookup with default implementations.
 * All methods return successful Results by default. Override specific methods as needed.
 */
export function createMockImportSessionLookup(): Mocked<IImportSessionLookup> {
  return {
    findLatestSessionPerAccount: vi.fn().mockResolvedValue(ok([])),
  };
}

/**
 * Creates a mock BlockchainProviderManager with default implementations.
 * Provides a single mock provider for the specified blockchain.
 *
 * The streamAddressTransactions method returns an async iterator by default.
 * Override it in tests to provide specific behavior:
 * ```
 * mockProviderManager.streamAddressTransactions.mockImplementation(async function* () {
 *   yield ok({ data: [...], providerName: '...', cursor: {...} });
 * });
 * ```
 *
 * @param blockchain - The blockchain identifier (e.g., 'ethereum', 'solana', 'bitcoin')
 */
export function createMockProviderManager(
  blockchain: string
): Mocked<
  Pick<
    BlockchainProviderManager,
    'autoRegisterFromConfig' | 'streamAddressTransactions' | 'getProviders' | 'getTokenMetadata'
  >
> {
  const mockProviderManager = {
    autoRegisterFromConfig: vi.fn<BlockchainProviderManager['autoRegisterFromConfig']>(),
    streamAddressTransactions: vi.fn<BlockchainProviderManager['streamAddressTransactions']>(),
    getProviders: vi.fn<BlockchainProviderManager['getProviders']>(),
    getTokenMetadata: vi.fn<BlockchainProviderManager['getTokenMetadata']>().mockResolvedValue(ok(new Map())),
  } as unknown as Mocked<
    Pick<
      BlockchainProviderManager,
      'autoRegisterFromConfig' | 'streamAddressTransactions' | 'getProviders' | 'getTokenMetadata'
    >
  >;

  mockProviderManager.autoRegisterFromConfig.mockReturnValue([]);

  // Default implementation: returns empty async iterator
  mockProviderManager.streamAddressTransactions.mockImplementation(async function* () {
    // By default, yield nothing. Tests should override this.
  });

  mockProviderManager.getProviders.mockReturnValue([
    {
      name: 'mock-provider',
      blockchain,
      capabilities: { supportedOperations: [] },
      execute: vi.fn(),
      isHealthy: vi.fn().mockResolvedValue(true),
      rateLimit: { requestsPerSecond: 1 },
      executeStreaming: vi.fn(async function* () {
        yield err(new Error('Streaming not implemented in mock'));
      }),
      extractCursors: vi.fn((_transaction: unknown): PaginationCursor[] => []),
      applyReplayWindow: vi.fn((cursor: PaginationCursor): PaginationCursor => cursor),
      destroy: vi.fn(),
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
  };
}
