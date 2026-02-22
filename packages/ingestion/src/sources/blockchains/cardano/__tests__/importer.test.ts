/**
 * Unit tests for the Cardano importer
 * Tests transaction fetching with provider failover
 */

import { assertOperationType, type BlockchainProviderManager, ProviderError } from '@exitbook/blockchain-providers';
import type { PaginationCursor } from '@exitbook/core';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { consumeImportStream } from '../../../../shared/test-utils/importer-test-utils.js';
import { CardanoTransactionImporter } from '../importer.js';

const USER_ADDRESS = 'addr1qyuser111111111111111111111111111111111111111111111111111111';
const EXTERNAL_ADDRESS = 'addr1qyexternal11111111111111111111111111111111111111111111111111';

const mockCardanoTx = {
  blockHeight: 9000000,
  blockId: 'block123',
  currency: 'ADA',
  feeAmount: '0.17',
  feeCurrency: 'ADA',
  id: 'tx1abc',
  inputs: [
    {
      address: EXTERNAL_ADDRESS,
      amounts: [
        {
          quantity: '2170000', // 2.17 ADA in lovelace
          unit: 'lovelace',
        },
      ],
      index: 0,
      txId: 'prev1',
    },
  ],
  outputs: [
    {
      address: USER_ADDRESS,
      amounts: [
        {
          quantity: '2000000', // 2.0 ADA
          unit: 'lovelace',
        },
      ],
      index: 0,
    },
  ],
  providerName: 'blockfrost',
  status: 'success',
  timestamp: Date.now(),
};

type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

describe('CardanoTransactionImporter', () => {
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
        blockchain: 'cardano',
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

  const createImporter = (options?: { preferredProvider?: string | undefined }): CardanoTransactionImporter =>
    new CardanoTransactionImporter(mockProviderManager as unknown as BlockchainProviderManager, options);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with Cardano provider manager', () => {
      const importer = createImporter();

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('cardano', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('cardano');
      expect(importer).toBeDefined();
    });

    test('should initialize with preferred provider', () => {
      const importer = createImporter({
        preferredProvider: 'blockfrost',
      });

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('cardano', 'blockfrost');
      expect(importer).toBeDefined();
    });
  });

  describe('Import - Success Cases', () => {
    test('should successfully fetch transactions', async () => {
      const importer = createImporter();

      const mockNormalized = {
        blockHeight: 9000000,
        currency: 'ADA',
        id: 'tx1abc',
        eventId: '0'.repeat(64),
        inputs: mockCardanoTx.inputs,
        outputs: mockCardanoTx.outputs,
      };

      // Mock executeWithFailover to return an async iterator
      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield okAsync({
          data: [{ normalized: mockNormalized, raw: mockCardanoTx }],
          providerName: 'blockfrost',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 9000000 },
            lastTransactionId: 'tx1abc',
            totalFetched: 1,
            metadata: {
              providerName: 'blockfrost',
              updatedAt: Date.now(),
              isComplete: true,
            },
          },
          isComplete: true,
          stats: { fetched: 1, deduplicated: 0, yielded: 1 },
        });
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'cardano',
        sourceType: 'blockchain' as const,
        address: USER_ADDRESS,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);

        // Verify transaction
        expect(result.value.rawTransactions[0]).toMatchObject({
          providerName: 'blockfrost',
          sourceAddress: USER_ADDRESS,
          normalizedData: mockNormalized,
          providerData: mockCardanoTx,
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
          providerName: 'blockfrost',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 0,
            metadata: {
              providerName: 'blockfrost',
              updatedAt: Date.now(),
              isComplete: true,
            },
          },
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
        });
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'cardano',
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

      const tx1 = mockCardanoTx;
      const tx2 = { ...mockCardanoTx, id: 'tx2def' };
      const tx3 = { ...mockCardanoTx, id: 'tx3ghi' };

      const multipleTxs = [
        { normalized: { ...tx1, id: 'tx1abc' }, raw: tx1 },
        { normalized: { ...tx2, id: 'tx2def' }, raw: tx2 },
        { normalized: { ...tx3, id: 'tx3ghi' }, raw: tx3 },
      ];

      // Mock executeWithFailover to return an async iterator with multiple transactions
      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield okAsync({
          data: multipleTxs,
          providerName: 'blockfrost',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 9000000 },
            lastTransactionId: 'tx3ghi',
            totalFetched: 3,
            metadata: {
              providerName: 'blockfrost',
              updatedAt: Date.now(),
              isComplete: true,
            },
          },
          isComplete: true,
          stats: { fetched: 3, deduplicated: 0, yielded: 3 },
        });
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'cardano',
        sourceType: 'blockchain' as const,
        address: USER_ADDRESS,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(3);
        expect(result.value.rawTransactions[0]!.providerData).toEqual(mockCardanoTx);
        expect(result.value.rawTransactions[1]!.providerData).toEqual({ ...mockCardanoTx, id: 'tx2def' });
        expect(result.value.rawTransactions[2]!.providerData).toEqual({ ...mockCardanoTx, id: 'tx3ghi' });
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
            blockchain: 'cardano',
          })
        );
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'cardano',
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

      const result = await consumeImportStream(importer, { sourceName: 'cardano', sourceType: 'blockchain' as const });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for Cardano transaction import');
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
          providerName: 'blockfrost',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 0,
            metadata: {
              providerName: 'blockfrost',
              updatedAt: Date.now(),
              isComplete: true,
            },
          },
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
        });
      });

      await consumeImportStream(importer, {
        sourceName: 'cardano',
        sourceType: 'blockchain' as const,
        address: USER_ADDRESS,
      });

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toBe(`cardano:raw-txs:${USER_ADDRESS}:all`);
    });
  });
});
