import { type IBlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { PaginationCursor } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { vi, type Mocked } from 'vitest';

/**
 * Creates a mock IBlockchainProviderManager with default implementations.
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
): Mocked<Pick<IBlockchainProviderManager, 'streamAddressTransactions' | 'getProviders' | 'getTokenMetadata'>> {
  const mockProviderManager = {
    streamAddressTransactions: vi.fn<IBlockchainProviderManager['streamAddressTransactions']>(),
    getProviders: vi.fn<IBlockchainProviderManager['getProviders']>(),
    getTokenMetadata: vi.fn<IBlockchainProviderManager['getTokenMetadata']>().mockResolvedValue(ok(new Map())),
  } as unknown as Mocked<
    Pick<IBlockchainProviderManager, 'streamAddressTransactions' | 'getProviders' | 'getTokenMetadata'>
  >;

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
