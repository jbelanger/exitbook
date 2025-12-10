/**
 * Unit tests for the generic Cosmos SDK importer
 * Tests the import pattern across multiple Cosmos SDK chains
 */

import type { CosmosTransaction } from '@exitbook/blockchain-providers';
import { type CosmosChainConfig, type BlockchainProviderManager, ProviderError } from '@exitbook/blockchain-providers';
import { assertOperationType } from '@exitbook/blockchain-providers/blockchain/__tests__/test-utils.js';
import type { CursorState, RawTransactionInput, PaginationCursor } from '@exitbook/core';
import { err, errAsync, ok, okAsync, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import type { ImportParams } from '../../../../types/importers.ts';
import { CosmosImporter } from '../importer.js';

/**
 * Result type for aggregated import stream
 */
interface ImportRunResult {
  rawTransactions: RawTransactionInput[];
  cursorUpdates: Record<string, CursorState>;
}

/**
 * Helper to consume streaming iterator
 */
async function consumeImportStream(
  importer: CosmosImporter,
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

const INJECTIVE_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'inj',
  chainId: 'injective-1',
  chainName: 'injective',
  displayName: 'Injective Protocol',
  nativeCurrency: 'INJ',
  nativeDecimals: 18,
};

const OSMOSIS_CONFIG: CosmosChainConfig = {
  bech32Prefix: 'osmo',
  chainId: 'osmosis-1',
  chainName: 'osmosis',
  displayName: 'Osmosis',
  nativeCurrency: 'OSMO',
  nativeDecimals: 6,
};

const mockCosmosTransaction = {
  amount: '1000000000000000000',
  blockHeight: 100,
  currency: 'INJ',
  feeAmount: '500000000000000',
  from: 'inj1abc...',
  hash: 'tx123',
  messageType: '/cosmos.bank.v1beta1.MsgSend',
  timestamp: Date.now(),
  to: 'inj1def...',
  id: 'tx123',
  status: 'pending',
  providerName: 'cosmos',
} as CosmosTransaction;

const mockIbcTransaction = {
  amount: '5000000',
  blockHeight: 101,
  bridgeType: 'ibc',
  currency: 'OSMO',
  feeAmount: '1000',
  from: 'osmo1abc...',
  hash: 'tx456',
  messageType: '/ibc.applications.transfer.v1.MsgTransfer',
  sourceChannel: 'channel-0',
  timestamp: Date.now(),
  to: 'osmo1def...',
  id: 'tx456',
  status: 'pending',
  providerName: 'cosmos',
};

type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

describe('CosmosImporter', () => {
  let mockProviderManager: ProviderManagerMock;

  /**
   * Helper to setup mock for transaction data
   */
  const setupMockData = (data: unknown[] = [], providerName = 'injective-explorer') => {
    mockProviderManager.executeWithFailover.mockImplementation(async function* () {
      yield okAsync({
        data,
        providerName,
        cursor: {
          primary: { type: 'blockNumber' as const, value: 0 },
          lastTransactionId: '',
          totalFetched: data.length,
          metadata: { providerName, updatedAt: Date.now(), isComplete: true },
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
        benchmarkRateLimit: vi.fn().mockResolvedValue({
          maxSafeRate: 1,
          recommended: { maxRequestsPerSecond: 1 },
          testResults: [],
        }),
        blockchain: 'injective',
        capabilities: { supportedOperations: [] },
        execute: vi.fn(),
        isHealthy: vi.fn().mockResolvedValue(true),
        name: 'mock-provider',
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
    config: CosmosChainConfig = INJECTIVE_CONFIG,
    options?: { preferredProvider?: string | undefined }
  ): CosmosImporter => new CosmosImporter(config, mockProviderManager as unknown as BlockchainProviderManager, options);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with Injective config', () => {
      const importer = createImporter();

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('injective', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('injective');
      expect(importer).toBeDefined();
    });

    test('should initialize with Osmosis config', () => {
      const importer = createImporter(OSMOSIS_CONFIG);

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('osmosis', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('osmosis');
      expect(importer).toBeDefined();
    });

    test('should initialize with preferred provider', () => {
      const importer = createImporter(INJECTIVE_CONFIG, {
        preferredProvider: 'injective-explorer',
      });

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('injective', 'injective-explorer');
      expect(importer).toBeDefined();
    });

    test('should throw error if provider manager is not provided', () => {
      expect(() => new CosmosImporter(INJECTIVE_CONFIG, undefined as unknown as BlockchainProviderManager)).toThrow(
        'Provider manager required for Injective Protocol importer'
      );
    });
  });

  describe('Import - Success Cases', () => {
    test('should successfully fetch transactions', async () => {
      const importer = createImporter();
      const address = 'inj1abc123def456ghi789';

      setupMockData([
        {
          raw: { block_timestamp: mockCosmosTransaction.timestamp, id: mockCosmosTransaction.id },
          normalized: mockCosmosTransaction,
        },
      ]);

      const result = await consumeImportStream(importer, {
        sourceName: 'cosmos',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);

        // Verify transaction metadata and data structure
        expect(result.value.rawTransactions[0]).toMatchObject({
          providerName: 'injective-explorer',
          sourceAddress: address,
          normalizedData: mockCosmosTransaction,
          providerData: { block_timestamp: mockCosmosTransaction.timestamp, id: mockCosmosTransaction.id },
        });
        expect(result.value.rawTransactions[0]?.externalId).toMatch(/^[a-f0-9]{64}$/);
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

    test('should handle IBC transactions', async () => {
      const importer = createImporter(OSMOSIS_CONFIG);
      const address = 'osmo1abc123def456ghi789';

      setupMockData(
        [
          {
            raw: { block_timestamp: mockIbcTransaction.timestamp, hash: mockIbcTransaction.hash },
            normalized: mockIbcTransaction,
          },
        ],
        'mintscan'
      );

      const result = await consumeImportStream(importer, {
        sourceName: 'cosmos',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);
        expect(result.value.rawTransactions[0]!.normalizedData).toEqual(mockIbcTransaction);
      }
    });

    test('should handle multiple transactions', async () => {
      const importer = createImporter();
      const address = 'inj1abc123def456ghi789';

      const tx2Normalized = { ...mockCosmosTransaction, hash: 'tx789' };
      const multipleTransactions = [
        {
          raw: { block_timestamp: mockCosmosTransaction.timestamp, id: mockCosmosTransaction.id },
          normalized: mockCosmosTransaction,
        },
        {
          raw: { block_timestamp: tx2Normalized.timestamp, id: tx2Normalized.id },
          normalized: tx2Normalized,
        },
        {
          raw: { block_timestamp: mockIbcTransaction.timestamp, id: mockIbcTransaction.id },
          normalized: mockIbcTransaction,
        },
      ];

      setupMockData(multipleTransactions);

      const result = await consumeImportStream(importer, {
        sourceName: 'cosmos',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(3);
        expect(result.value.rawTransactions[0]!.normalizedData).toEqual(mockCosmosTransaction);
        expect(result.value.rawTransactions[1]!.normalizedData).toEqual(tx2Normalized);
        expect(result.value.rawTransactions[2]!.normalizedData).toEqual(mockIbcTransaction);
      }
    });

    test('should handle empty transaction list', async () => {
      const importer = createImporter();
      const address = 'inj1abc123def456ghi789';

      setupMockData([]);

      const result = await consumeImportStream(importer, {
        sourceName: 'cosmos',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(0);
      }
    });
  });

  describe('Import - Error Cases', () => {
    test('should fail if transactions fetch fails', async () => {
      const importer = createImporter();
      const address = 'inj1abc123def456ghi789';

      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield errAsync(
          new ProviderError('Failed to fetch transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'injective',
          })
        );
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'cosmos',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch transactions');
      }
    });

    test('should return error if address is not provided', async () => {
      const importer = createImporter();

      const result = await consumeImportStream(importer, { sourceName: 'cosmos', sourceType: 'blockchain' as const });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for Injective Protocol transaction import');
      }
    });

    test('should return error if address is empty string', async () => {
      const importer = createImporter();

      const result = await consumeImportStream(importer, {
        sourceName: 'cosmos',
        sourceType: 'blockchain' as const,
        address: '',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for Injective Protocol transaction import');
      }
    });
  });

  describe('Multi-Chain Support', () => {
    test('should work with Osmosis config', async () => {
      const importer = createImporter(OSMOSIS_CONFIG);
      const address = 'osmo1abc123def456ghi789';

      setupMockData(
        [
          {
            raw: { block_timestamp: mockIbcTransaction.timestamp, hash: mockIbcTransaction.hash },
            normalized: mockIbcTransaction,
          },
        ],
        'mintscan'
      );

      const result = await consumeImportStream(importer, {
        sourceName: 'cosmos',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);

      // Verify calls were made with 'osmosis' blockchain name
      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      expect(executeCalls[0]?.[0]).toBe('osmosis');

      const [, operation] = executeCalls[0]!;
      assertOperationType(operation, 'getAddressTransactions');
      expect(operation.address).toBe(address);
    });

    test('should generate correct error messages for different chains', async () => {
      const osmosisImporter = createImporter(OSMOSIS_CONFIG);

      const result = await consumeImportStream(osmosisImporter, {
        sourceName: 'cosmos',
        sourceType: 'blockchain' as const,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for Osmosis transaction import');
      }
    });
  });

  describe('Cache Key Generation', () => {
    test('should generate correct cache keys', async () => {
      const importer = createImporter();
      const address = 'inj1abc123def456ghi789';

      setupMockData([]);

      await consumeImportStream(importer, { sourceName: 'cosmos', sourceType: 'blockchain' as const, address });

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toBe(`injective:raw-txs:${address}:all`);
    });
  });
});
