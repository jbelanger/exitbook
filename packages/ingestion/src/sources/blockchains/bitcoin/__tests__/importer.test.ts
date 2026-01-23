/**
 * Unit tests for the Bitcoin importer
 * Tests transaction fetching with provider failover
 */

import { type BlockchainProviderManager, ProviderError } from '@exitbook/blockchain-providers';
import { getBitcoinChainConfig } from '@exitbook/blockchain-providers';
import { assertOperationType } from '@exitbook/blockchain-providers/blockchain/__tests__/test-utils.js';
import type { PaginationCursor } from '@exitbook/core';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { consumeImportStream } from '../../../../shared/test-utils/importer-test-utils.js';
import { BitcoinTransactionImporter } from '../importer.js';

const USER_ADDRESS = 'bc1quser1111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'bc1qexternal111111111111111111111111111';

const mockBitcoinTx = {
  blockHeight: 800000,
  currency: 'BTC',
  feeAmount: '0.0001',
  feeCurrency: 'BTC',
  id: 'tx1abc',
  inputs: [
    {
      address: EXTERNAL_ADDRESS,
      txid: 'prev1',
      value: '200010000', // 2.0001 BTC in satoshis
      vout: 0,
    },
  ],
  outputs: [
    {
      address: USER_ADDRESS,
      index: 0,
      value: '200000000', // 2.0 BTC
    },
  ],
  providerName: 'blockstream.info',
  status: 'success',
  timestamp: Date.now(),
};

type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

describe('BitcoinTransactionImporter', () => {
  let mockProviderManager: ProviderManagerMock;

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
        blockchain: 'bitcoin',
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
        destroy: vi.fn(),
      },
    ]);
  });

  const createImporter = (options?: { preferredProvider?: string | undefined }): BitcoinTransactionImporter => {
    const chainConfig = getBitcoinChainConfig('bitcoin');
    if (!chainConfig) {
      throw new Error('Bitcoin chain config not found');
    }
    return new BitcoinTransactionImporter(
      chainConfig,
      mockProviderManager as unknown as BlockchainProviderManager,
      options
    );
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with Bitcoin provider manager', () => {
      const importer = createImporter();

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('bitcoin', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('bitcoin');
      expect(importer).toBeDefined();
    });

    test('should initialize with preferred provider', () => {
      const importer = createImporter({
        preferredProvider: 'blockstream.info',
      });

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('bitcoin', 'blockstream.info');
      expect(importer).toBeDefined();
    });

    test('should throw error if provider manager is not provided', () => {
      const chainConfig = getBitcoinChainConfig('bitcoin');
      if (!chainConfig) {
        throw new Error('Bitcoin chain config not found');
      }

      expect(
        () => new BitcoinTransactionImporter(chainConfig, undefined as unknown as BlockchainProviderManager)
      ).toThrow('Provider manager required for bitcoin importer');
    });
  });

  describe('Import - Success Cases', () => {
    test('should successfully fetch transactions', async () => {
      const importer = createImporter();

      const mockNormalized = {
        blockHeight: 800000,
        currency: 'BTC',
        id: 'tx1abc',
        eventId: '0'.repeat(64),
        inputs: mockBitcoinTx.inputs,
        outputs: mockBitcoinTx.outputs,
      };

      // Mock executeWithFailover to return an async iterator
      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield okAsync({
          data: [{ normalized: mockNormalized, raw: mockBitcoinTx }],
          providerName: 'blockstream.info',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 800000 },
            lastTransactionId: 'tx1abc',
            totalFetched: 1,
            metadata: {
              providerName: 'blockstream.info',
              updatedAt: Date.now(),
              isComplete: true,
            },
          },
          isComplete: true,
          stats: {
            fetched: 1,
            deduplicated: 0,
            yielded: 1,
          },
        });
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'bitcoin',
        sourceType: 'blockchain' as const,
        address: USER_ADDRESS,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);

        // Verify transaction
        expect(result.value.rawTransactions[0]).toMatchObject({
          providerName: 'blockstream.info',
          sourceAddress: USER_ADDRESS,
          normalizedData: mockNormalized,
          providerData: mockBitcoinTx,
        });
        expect(result.value.rawTransactions[0]?.eventId).toMatch(/^[a-f0-9]{64}$/);
      }

      // Verify API call was made
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(1);

      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const [, operation] = executeCalls[0]!;
      assertOperationType(operation, 'getAddressTransactions');
      expect(operation.address).toBe(USER_ADDRESS);
      expect(operation.getCacheKey).toBeDefined();
    });

    test('should handle empty transaction list', async () => {
      const importer = createImporter();

      // Mock executeWithFailover to return an async iterator with empty data
      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield okAsync({
          data: [],
          providerName: 'blockstream.info',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 0,
            metadata: {
              providerName: 'blockstream.info',
              updatedAt: Date.now(),
              isComplete: true,
            },
          },
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
        });
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'bitcoin',
        sourceType: 'blockchain' as const,
        address: USER_ADDRESS,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(0);
      }
    });

    test('should handle array of transactions from provider', async () => {
      const importer = createImporter();

      const tx1 = mockBitcoinTx;
      const tx2 = { ...mockBitcoinTx, id: 'tx2def' };
      const tx3 = { ...mockBitcoinTx, id: 'tx3ghi' };

      const multipleTxs = [
        { normalized: { ...tx1, id: 'tx1abc' }, raw: tx1 },
        { normalized: { ...tx2, id: 'tx2def' }, raw: tx2 },
        { normalized: { ...tx3, id: 'tx3ghi' }, raw: tx3 },
      ];

      // Mock executeWithFailover to return an async iterator with multiple transactions
      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield okAsync({
          data: multipleTxs,
          providerName: 'blockstream.info',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 800000 },
            lastTransactionId: 'tx3ghi',
            totalFetched: 3,
            metadata: {
              providerName: 'blockstream.info',
              updatedAt: Date.now(),
              isComplete: true,
            },
          },
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
        });
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'bitcoin',
        sourceType: 'blockchain' as const,
        address: USER_ADDRESS,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(3);
        expect(result.value.rawTransactions[0]!.providerData).toEqual(mockBitcoinTx);
        expect(result.value.rawTransactions[1]!.providerData).toEqual({ ...mockBitcoinTx, id: 'tx2def' });
        expect(result.value.rawTransactions[2]!.providerData).toEqual({ ...mockBitcoinTx, id: 'tx3ghi' });
      }
    });
  });

  describe('Import - Error Cases', () => {
    test('should fail if provider fails', async () => {
      const importer = createImporter();

      // Mock executeWithFailover to return an async iterator that yields an error
      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield errAsync(
          new ProviderError('Failed to fetch transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'bitcoin',
          })
        );
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'bitcoin',
        sourceType: 'blockchain' as const,
        address: USER_ADDRESS,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch transactions');
      }
    });

    test('should return error if address is not provided', async () => {
      const importer = createImporter();

      const result = await consumeImportStream(importer, { sourceName: 'bitcoin', sourceType: 'blockchain' as const });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for Bitcoin transaction import');
      }
    });
  });

  describe('Cache Key Generation', () => {
    test('should generate correct cache key', async () => {
      const importer = createImporter();

      // Mock executeWithFailover to return an async iterator with empty data
      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield okAsync({
          data: [],
          providerName: 'blockstream.info',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 0,
            metadata: {
              providerName: 'blockstream.info',
              updatedAt: Date.now(),
            },
          },
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
        });
      });

      await consumeImportStream(importer, {
        sourceName: 'bitcoin',
        sourceType: 'blockchain' as const,
        address: USER_ADDRESS,
      });

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toBe(`bitcoin:raw-txs:${USER_ADDRESS}:all`);
    });
  });
});
