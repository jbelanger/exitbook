/**
 * Unit tests for the generic EVM importer
 * Tests the three-method fetch pattern (normal, internal, token) across multiple chains
 */

import { type EvmChainConfig, type BlockchainProviderManager, ProviderError } from '@exitbook/blockchain-providers';
import { assertOperationType } from '@exitbook/blockchain-providers/blockchain/__tests__/test-utils.js';
import type { CursorState, RawTransactionInput, PaginationCursor } from '@exitbook/core';
import { err, errAsync, ok, okAsync, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import type { ImportParams, ImportRunResult } from '../../../../types/importers.ts';
import { EvmImporter } from '../importer.js';

/**
 * Helper to consume streaming iterator
 */
async function consumeImportStream(
  importer: EvmImporter,
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

const ETHEREUM_CONFIG: EvmChainConfig = {
  chainId: 1,
  chainName: 'ethereum',
  nativeCurrency: 'ETH',
  nativeDecimals: 18,
};

const AVALANCHE_CONFIG: EvmChainConfig = {
  chainId: 43114,
  chainName: 'avalanche',
  nativeCurrency: 'AVAX',
  nativeDecimals: 18,
};

const mockNormalTx = { hash: '0x123', from: '0xabc', to: '0xdef', value: '1000000000000000000' };
const mockInternalTx = { hash: '0x123', from: '0xdef', to: '0xghi', value: '500000000000000000' };
const mockTokenTx = {
  hash: '0x456',
  from: '0xabc',
  to: '0xdef',
  tokenAddress: '0xtoken',
  value: '1000000',
};

type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

describe('EvmImporter', () => {
  let mockProviderManager: ProviderManagerMock;

  /**
   * Helper to setup mocks for all three transaction types (normal, internal, token)
   */
  const setupDefaultMocks = (normalData: unknown[] = [], internalData: unknown[] = [], tokenData: unknown[] = []) => {
    mockProviderManager.executeWithFailover
      .mockImplementationOnce(async function* () {
        yield okAsync({
          data: normalData,
          providerName: 'alchemy',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: normalData.length,
            metadata: { providerName: 'alchemy', updatedAt: Date.now(), isComplete: true },
          },
        });
      })
      .mockImplementationOnce(async function* () {
        yield okAsync({
          data: internalData,
          providerName: 'alchemy',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: internalData.length,
            metadata: { providerName: 'alchemy', updatedAt: Date.now(), isComplete: true },
          },
        });
      })
      .mockImplementationOnce(async function* () {
        yield okAsync({
          data: tokenData,
          providerName: 'alchemy',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: tokenData.length,
            metadata: { providerName: 'alchemy', updatedAt: Date.now(), isComplete: true },
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
        blockchain: 'ethereum',
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

  const createImporter = (
    config: EvmChainConfig = ETHEREUM_CONFIG,
    options?: { preferredProvider?: string | undefined }
  ): EvmImporter => new EvmImporter(config, mockProviderManager as unknown as BlockchainProviderManager, options);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with Ethereum config', () => {
      const importer = createImporter();

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('ethereum', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('ethereum');
      expect(importer).toBeDefined();
    });

    test('should initialize with Avalanche config', () => {
      const importer = createImporter(AVALANCHE_CONFIG);

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('avalanche', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('avalanche');
      expect(importer).toBeDefined();
    });

    test('should initialize with preferred provider', () => {
      const importer = createImporter(ETHEREUM_CONFIG, {
        preferredProvider: 'alchemy',
      });

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('ethereum', 'alchemy');
      expect(importer).toBeDefined();
    });

    test('should throw error if provider manager is not provided', () => {
      expect(() => new EvmImporter(ETHEREUM_CONFIG, undefined as unknown as BlockchainProviderManager)).toThrow(
        'Provider manager required for ethereum importer'
      );
    });
  });

  describe('Import - Success Cases', () => {
    test('should successfully fetch all three transaction types', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      setupDefaultMocks(
        [{ raw: mockNormalTx, normalized: { id: mockNormalTx.hash } }],
        [{ raw: mockInternalTx, normalized: { id: mockInternalTx.hash } }],
        [{ raw: mockTokenTx, normalized: { id: mockTokenTx.hash } }]
      );

      const result = await consumeImportStream(importer, { address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(3);

        // Verify normal transaction
        expect(result.value.rawTransactions[0]).toMatchObject({
          providerName: 'alchemy',
          sourceAddress: address,
          transactionTypeHint: 'normal',
          rawData: mockNormalTx,
          normalizedData: { id: mockNormalTx.hash },
        });
        expect(result.value.rawTransactions[0]?.externalId).toMatch(/^[a-f0-9]{64}$/);

        // Verify internal transaction
        expect(result.value.rawTransactions[1]).toMatchObject({
          providerName: 'alchemy',
          sourceAddress: address,
          transactionTypeHint: 'internal',
          rawData: mockInternalTx,
          normalizedData: { id: mockInternalTx.hash },
        });
        expect(result.value.rawTransactions[1]?.externalId).toMatch(/^[a-f0-9]{64}$/);

        // Verify token transaction
        expect(result.value.rawTransactions[2]).toMatchObject({
          providerName: 'alchemy',
          sourceAddress: address,
          transactionTypeHint: 'token',
          rawData: mockTokenTx,
          normalizedData: { id: mockTokenTx.hash },
        });
        expect(result.value.rawTransactions[2]?.externalId).toMatch(/^[a-f0-9]{64}$/);
      }

      // Verify all three API calls were made (one for each transaction type)
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(3);

      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const [, normalOperation] = executeCalls[0]!;
      assertOperationType(normalOperation, 'getAddressTransactions');
      expect(normalOperation.address).toBe(address);
      expect(normalOperation.getCacheKey).toBeDefined();

      const [, internalOperation] = executeCalls[1]!;
      assertOperationType(internalOperation, 'getAddressInternalTransactions');
      expect(internalOperation.address).toBe(address);
      expect(internalOperation.getCacheKey).toBeDefined();

      const [, tokenOperation] = executeCalls[2]!;
      assertOperationType(tokenOperation, 'getAddressTokenTransactions');
      expect(tokenOperation.address).toBe(address);
      expect(tokenOperation.getCacheKey).toBeDefined();
    });
  });

  describe('Import - Error Cases', () => {
    test('should fail if normal transactions fail', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      // First call (normal) fails
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield errAsync(
          new ProviderError('Failed to fetch normal transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'ethereum',
          })
        );
      });

      const result = await consumeImportStream(importer, { address });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch normal transactions');
      }
    });

    test('should return error if address is not provided', async () => {
      const importer = createImporter();

      const result = await consumeImportStream(importer, {});

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for ethereum transaction import');
      }
    });
  });

  describe('Multi-Chain Support', () => {
    test('should work with Avalanche config', async () => {
      const importer = createImporter(AVALANCHE_CONFIG);
      const address = '0x1234567890123456789012345678901234567890';

      setupDefaultMocks([{ raw: mockNormalTx, normalized: { id: mockNormalTx.hash } }], [], []);

      const result = await consumeImportStream(importer, { address });

      expect(result.isOk()).toBe(true);

      // Verify calls were made with 'avalanche' blockchain name
      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      expect(executeCalls[0]?.[0]).toBe('avalanche');
      expect(executeCalls[1]?.[0]).toBe('avalanche');
      expect(executeCalls[2]?.[0]).toBe('avalanche');

      const [, normalOperation] = executeCalls[0]!;
      assertOperationType(normalOperation, 'getAddressTransactions');
      expect(normalOperation.address).toBe(address);

      const [, internalOperation] = executeCalls[1]!;
      assertOperationType(internalOperation, 'getAddressInternalTransactions');
      expect(internalOperation.address).toBe(address);

      const [, tokenOperation] = executeCalls[2]!;
      assertOperationType(tokenOperation, 'getAddressTokenTransactions');
      expect(tokenOperation.address).toBe(address);
    });

    test('should handle array of transactions from provider', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      const multipleNormalTxs = [
        { raw: mockNormalTx, normalized: { id: mockNormalTx.hash } },
        { raw: { ...mockNormalTx, hash: '0x789' }, normalized: { id: '0x789' } },
      ];

      setupDefaultMocks(multipleNormalTxs, [], []);

      const result = await consumeImportStream(importer, { address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(2);
        expect(result.value.rawTransactions[0]!.rawData).toEqual(mockNormalTx);
        expect(result.value.rawTransactions[1]!.rawData).toEqual({ ...mockNormalTx, hash: '0x789' });
      }
    });
  });

  describe('Cache Key Generation', () => {
    test('should generate correct cache keys for each transaction type', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      setupDefaultMocks([], [], []);

      await consumeImportStream(importer, { address });

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const normalCall = calls[0]![1];
      const normalCacheKey = normalCall.getCacheKey!(normalCall);
      expect(normalCacheKey).toBe('ethereum:normal-txs:0x1234567890123456789012345678901234567890:all');

      const internalCall = calls[1]![1];
      const internalCacheKey = internalCall.getCacheKey!(internalCall);
      expect(internalCacheKey).toBe('ethereum:internal-txs:0x1234567890123456789012345678901234567890:all');

      const tokenCall = calls[2]![1];
      const tokenCacheKey = tokenCall.getCacheKey!(tokenCall);
      expect(tokenCacheKey).toBe('ethereum:token-txs:0x1234567890123456789012345678901234567890:all');
    });
  });
});
