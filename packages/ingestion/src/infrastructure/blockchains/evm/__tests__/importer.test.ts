/**
 * Unit tests for the generic EVM importer
 * Tests the three-method fetch pattern (normal, internal, token) across multiple chains
 */

import { type EvmChainConfig, type BlockchainProviderManager, ProviderError } from '@exitbook/blockchain-providers';
import { assertOperationType } from '@exitbook/blockchain-providers/blockchain/__tests__/test-utils.js';
import type { PaginationCursor } from '@exitbook/core';
import { errAsync, ok, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { EvmImporter } from '../importer.js';

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
  Pick<
    BlockchainProviderManager,
    'autoRegisterFromConfig' | 'executeWithFailover' | 'executeWithFailoverStreaming' | 'getProviders'
  >
>;

describe('EvmImporter', () => {
  let mockProviderManager: ProviderManagerMock;

  beforeEach(() => {
    mockProviderManager = {
      autoRegisterFromConfig: vi.fn<BlockchainProviderManager['autoRegisterFromConfig']>(),
      executeWithFailover: vi.fn<BlockchainProviderManager['executeWithFailover']>(),
      executeWithFailoverStreaming: vi.fn<BlockchainProviderManager['executeWithFailoverStreaming']>(),
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

    // Default streaming mock implementation - yields empty batch (will be overridden per test)
    mockProviderManager.executeWithFailoverStreaming.mockImplementation(async function* () {
      yield Promise.resolve(
        ok({
          data: [],
          providerName: 'alchemy',
          cursor: { primary: { type: 'blockNumber' as const, value: 0 }, lastTransactionId: '', totalFetched: 0 },
        })
      );
    });
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

      // Mock streaming responses for each transaction type
      mockProviderManager.executeWithFailoverStreaming.mockImplementation(async function* (_blockchain, operation) {
        if (operation.type === 'getAddressTransactions') {
          yield okAsync({
            data: [{ raw: mockNormalTx, normalized: { id: mockNormalTx.hash } }],
            providerName: 'alchemy',
            cursor: {
              primary: { type: 'blockNumber' as const, value: 1 },
              lastTransactionId: mockNormalTx.hash,
              totalFetched: 1,
            },
          });
        } else if (operation.type === 'getAddressInternalTransactions') {
          yield ok({
            data: [{ raw: mockInternalTx, normalized: { id: mockInternalTx.hash } }],
            providerName: 'alchemy',
            cursor: {
              primary: { type: 'blockNumber' as const, value: 1 },
              lastTransactionId: mockInternalTx.hash,
              totalFetched: 1,
            },
          });
        } else if (operation.type === 'getAddressTokenTransactions') {
          yield ok({
            data: [{ raw: mockTokenTx, normalized: { id: mockTokenTx.hash } }],
            providerName: 'alchemy',
            cursor: {
              primary: { type: 'blockNumber' as const, value: 1 },
              lastTransactionId: mockTokenTx.hash,
              totalFetched: 1,
            },
          });
        }
      });

      const result = await importer.import({ address });

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

      // Verify all three streaming calls were made (one for each transaction type)
      expect(mockProviderManager.executeWithFailoverStreaming).toHaveBeenCalledTimes(3);

      const streamingCalls: Parameters<BlockchainProviderManager['executeWithFailoverStreaming']>[] =
        mockProviderManager.executeWithFailoverStreaming.mock.calls;

      const [, normalOperation] = streamingCalls[0]!;
      assertOperationType(normalOperation, 'getAddressTransactions');
      expect(normalOperation.address).toBe(address);
      expect(normalOperation.getCacheKey).toBeDefined();

      const [, internalOperation] = streamingCalls[1]!;
      assertOperationType(internalOperation, 'getAddressInternalTransactions');
      expect(internalOperation.address).toBe(address);
      expect(internalOperation.getCacheKey).toBeDefined();

      const [, tokenOperation] = streamingCalls[2]!;
      assertOperationType(tokenOperation, 'getAddressTokenTransactions');
      expect(tokenOperation.address).toBe(address);
      expect(tokenOperation.getCacheKey).toBeDefined();
    });
  });

  describe('Import - Error Cases', () => {
    test('should fail if normal transactions fail', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      // Mock streaming to fail for normal transactions
      mockProviderManager.executeWithFailoverStreaming.mockImplementation(async function* (_blockchain, operation) {
        if (operation.type === 'getAddressTransactions') {
          yield errAsync(
            new ProviderError('Failed to fetch normal transactions', 'ALL_PROVIDERS_FAILED', {
              blockchain: 'ethereum',
            })
          );
        } else if (operation.type === 'getAddressInternalTransactions') {
          yield ok({
            data: [{ raw: mockInternalTx, normalized: { id: mockInternalTx.hash } }],
            providerName: 'alchemy',
            cursor: {
              primary: { type: 'blockNumber' as const, value: 1 },
              lastTransactionId: mockInternalTx.hash,
              totalFetched: 1,
            },
          });
        } else if (operation.type === 'getAddressTokenTransactions') {
          yield ok({
            data: [{ raw: mockTokenTx, normalized: { id: mockTokenTx.hash } }],
            providerName: 'alchemy',
            cursor: {
              primary: { type: 'blockNumber' as const, value: 1 },
              lastTransactionId: mockTokenTx.hash,
              totalFetched: 1,
            },
          });
        }
      });

      const result = await importer.import({ address });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch normal transactions');
      }
    });

    test('should return error if address is not provided', async () => {
      const importer = createImporter();

      const result = await importer.import({});

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

      mockProviderManager.executeWithFailoverStreaming.mockImplementation(async function* () {
        yield okAsync({
          data: [{ raw: mockNormalTx, normalized: { id: mockNormalTx.hash } }],
          providerName: 'snowtrace',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 1 },
            lastTransactionId: mockNormalTx.hash,
            totalFetched: 1,
          },
        });
      });

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);

      // Verify calls were made with 'avalanche' blockchain name
      const streamingCalls: Parameters<BlockchainProviderManager['executeWithFailoverStreaming']>[] =
        mockProviderManager.executeWithFailoverStreaming.mock.calls;

      expect(streamingCalls[0]?.[0]).toBe('avalanche');
      expect(streamingCalls[1]?.[0]).toBe('avalanche');
      expect(streamingCalls[2]?.[0]).toBe('avalanche');

      const [, normalOperation] = streamingCalls[0]!;
      assertOperationType(normalOperation, 'getAddressTransactions');
      expect(normalOperation.address).toBe(address);

      const [, internalOperation] = streamingCalls[1]!;
      assertOperationType(internalOperation, 'getAddressInternalTransactions');
      expect(internalOperation.address).toBe(address);

      const [, tokenOperation] = streamingCalls[2]!;
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

      mockProviderManager.executeWithFailoverStreaming.mockImplementation(async function* (_blockchain, operation) {
        if (operation.type === 'getAddressTransactions') {
          yield okAsync({
            data: multipleNormalTxs,
            providerName: 'alchemy',
            cursor: {
              primary: { type: 'blockNumber' as const, value: 2 },
              lastTransactionId: '0x789',
              totalFetched: 2,
            },
          });
        } else {
          yield okAsync({
            data: [],
            providerName: 'alchemy',
            cursor: {
              primary: { type: 'blockNumber' as const, value: 0 },
              lastTransactionId: '',
              totalFetched: 0,
            },
          });
        }
      });

      const result = await importer.import({ address });

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

      mockProviderManager.executeWithFailoverStreaming.mockImplementation(async function* () {
        yield okAsync({
          data: [],
          providerName: 'alchemy',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 0,
          },
        });
      });

      await importer.import({ address });

      const calls: Parameters<BlockchainProviderManager['executeWithFailoverStreaming']>[] =
        mockProviderManager.executeWithFailoverStreaming.mock.calls;

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
