/**
 * Unit tests for the Solana importer
 * Tests transaction fetching with provider failover
 */

import { ProviderError, type BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { assertOperationType } from '@exitbook/blockchain-providers/blockchain/__tests__/test-utils.js';
import type { CursorState, RawTransactionInput, PaginationCursor } from '@exitbook/core';
import { err, errAsync, ok, okAsync, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import type { ImportParams, ImportRunResult } from '../../../../types/importers.ts';
import { SolanaTransactionImporter } from '../importer.js';

/**
 * Helper to consume streaming iterator
 */
async function consumeImportStream(
  importer: SolanaTransactionImporter,
  params: ImportParams
): Promise<Result<ImportRunResult, Error>> {
  const allTransactions: RawTransactionInput[] = [];
  const cursorUpdates: Record<string, CursorState> = {};

  for await (const batchResult of importer.importStreaming(params)) {
    if (batchResult.isErr()) {
      return err(batchResult.error);
    }

    const batch = batchResult.value;
    allTransactions.push(...batch.rawTransactions);
    cursorUpdates[batch.operationType] = batch.cursor;
  }

  return ok({
    rawTransactions: allTransactions,
    cursorUpdates,
  });
}

const mockSolTx = {
  signature: 'sig123abc',
  slot: 100000,
  from: 'user1111111111111111111111111111111111111111',
  to: 'user2222222222222222222222222222222222222222',
  amount: '1000000000', // 1 SOL in lamports
  fee: '5000',
};

const mockTokenTx = {
  signature: 'sig456def',
  slot: 100001,
  from: 'user1111111111111111111111111111111111111111',
  to: 'user2222222222222222222222222222222222222222',
  tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: '1000000', // 1 USDC (6 decimals)
};

type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

describe('SolanaTransactionImporter', () => {
  let mockProviderManager: ProviderManagerMock;

  /**
   * Helper to setup mock for transaction data
   */
  const setupMockData = (data: unknown[] = []) => {
    mockProviderManager.executeWithFailover.mockImplementation(async function* () {
      yield okAsync({
        data,
        providerName: 'helius',
        cursor: {
          primary: { type: 'blockNumber' as const, value: 0 },
          lastTransactionId: '',
          totalFetched: data.length,
          metadata: { providerName: 'helius', updatedAt: Date.now(), isComplete: true },
        },
      });
    });
  };

  beforeEach(() => {
    mockProviderManager = {
      autoRegisterFromConfig: vi.fn<BlockchainProviderManager['autoRegisterFromConfig']>(),
      executeWithFailover: vi.fn<BlockchainProviderManager['executeWithFailover']>(),
      getProviders: vi.fn<BlockchainProviderManager['getProviders']>(),
    } as unknown as ProviderManagerMock;

    mockProviderManager.autoRegisterFromConfig.mockReturnValue([]);
    mockProviderManager.getProviders.mockReturnValue([
      {
        name: 'mock-provider',
        blockchain: 'solana',
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
  });

  const createImporter = (options?: { preferredProvider?: string | undefined }): SolanaTransactionImporter =>
    new SolanaTransactionImporter(mockProviderManager as unknown as BlockchainProviderManager, options);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with Solana provider manager', () => {
      const importer = createImporter();

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('solana', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('solana');
      expect(importer).toBeDefined();
    });

    test('should initialize with preferred provider', () => {
      const importer = createImporter({
        preferredProvider: 'helius',
      });

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('solana', 'helius');
      expect(importer).toBeDefined();
    });

    test('should throw error if provider manager is not provided', () => {
      expect(() => new SolanaTransactionImporter(undefined as unknown as BlockchainProviderManager)).toThrow(
        'Provider manager required for Solana importer'
      );
    });
  });

  describe('Import - Success Cases', () => {
    test('should successfully fetch transactions', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      const mockNormalizedSol = { id: 'sig123abc', amount: '1', currency: 'SOL' };
      const mockNormalizedToken = { id: 'sig456def', amount: '1', currency: 'USDC' };

      setupMockData([
        { normalized: mockNormalizedSol, raw: mockSolTx },
        { normalized: mockNormalizedToken, raw: mockTokenTx },
      ]);

      const result = await consumeImportStream(importer, { address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(2);

        // Verify SOL transaction
        expect(result.value.rawTransactions[0]).toMatchObject({
          providerName: 'helius',
          sourceAddress: address,
          normalizedData: mockNormalizedSol,
          rawData: mockSolTx,
        });
        expect(result.value.rawTransactions[0]?.externalId).toMatch(/^[a-f0-9]{64}$/);

        // Verify token transaction
        expect(result.value.rawTransactions[1]).toMatchObject({
          providerName: 'helius',
          sourceAddress: address,
          normalizedData: mockNormalizedToken,
          rawData: mockTokenTx,
        });
        expect(result.value.rawTransactions[1]?.externalId).toMatch(/^[a-f0-9]{64}$/);
      }

      // Verify API call was made
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(1);

      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const [, operation] = executeCalls[0]!;
      assertOperationType(operation, 'getAddressTransactions');
      expect(operation.address).toBe(address);
      expect(operation.getCacheKey).toBeDefined();
    });

    test('should handle empty transaction list', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      setupMockData([]);

      const result = await consumeImportStream(importer, { address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(0);
      }
    });

    test('should handle array of transactions from provider', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      const tx1 = mockSolTx;
      const tx2 = { ...mockSolTx, signature: 'sig789' };
      const tx3 = { ...mockSolTx, signature: 'sig012' };

      const multipleTxs = [
        { normalized: { id: 'sig123abc' }, raw: tx1 },
        { normalized: { id: 'sig789' }, raw: tx2 },
        { normalized: { id: 'sig012' }, raw: tx3 },
      ];

      setupMockData(multipleTxs);

      const result = await consumeImportStream(importer, { address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(3);
        expect(result.value.rawTransactions[0]!.rawData).toEqual(mockSolTx);
        expect(result.value.rawTransactions[1]!.rawData).toEqual({ ...mockSolTx, signature: 'sig789' });
        expect(result.value.rawTransactions[2]!.rawData).toEqual({ ...mockSolTx, signature: 'sig012' });
      }
    });
  });

  describe('Import - Error Cases', () => {
    test('should fail if provider fails', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield errAsync(
          new ProviderError('Failed to fetch transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'solana',
          })
        );
      });

      const result = await consumeImportStream(importer, { address });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch transactions');
      }
    });

    test('should return error if address is not provided', async () => {
      const importer = createImporter();

      const result = await consumeImportStream(importer, {});

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for Solana transaction import');
      }
    });
  });

  describe('Cache Key Generation', () => {
    test('should generate correct cache key', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      setupMockData([]);

      await consumeImportStream(importer, { address });

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toBe('solana:raw-txs:user1111111111111111111111111111111111111111:all');
    });
  });
});
