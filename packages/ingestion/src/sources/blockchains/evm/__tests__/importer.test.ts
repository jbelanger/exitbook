/**
 * Unit tests for the generic EVM importer
 * Tests the three-method fetch pattern (normal, internal, token) across multiple chains
 */

import { type BlockchainProviderManager, type EvmChainConfig, ProviderError } from '@exitbook/blockchain-providers';
import { assertOperationType } from '@exitbook/blockchain-providers/blockchain/__tests__/test-utils.js';
import type { PaginationCursor } from '@exitbook/core';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { consumeImportStream } from '../../../../shared/test-utils/importer-test-utils.js';
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
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
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
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
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
          isComplete: true,
          stats: { fetched: 0, deduplicated: 0, yielded: 0 },
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
        [
          {
            raw: mockNormalTx,
            normalized: { id: mockNormalTx.hash, eventId: '0'.repeat(64), type: 'transfer' as const },
          },
        ],
        [
          {
            raw: mockInternalTx,
            normalized: { id: mockInternalTx.hash, eventId: '1'.repeat(64), type: 'internal' as const },
          },
        ],
        [
          {
            raw: mockTokenTx,
            normalized: { id: mockTokenTx.hash, eventId: '2'.repeat(64), type: 'token_transfer' as const },
          },
        ]
      );

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(3);

        // Verify normal transaction
        expect(result.value.rawTransactions[0]).toMatchObject({
          providerName: 'alchemy',
          sourceAddress: address,
          transactionTypeHint: 'normal',
          providerData: mockNormalTx,
          normalizedData: { id: mockNormalTx.hash, eventId: '0'.repeat(64) },
        });
        expect(result.value.rawTransactions[0]?.eventId).toMatch(/^[a-f0-9]{64}$/);

        // Verify internal transaction
        expect(result.value.rawTransactions[1]).toMatchObject({
          providerName: 'alchemy',
          sourceAddress: address,
          transactionTypeHint: 'internal',
          providerData: mockInternalTx,
          normalizedData: { id: mockInternalTx.hash, eventId: '1'.repeat(64) },
        });
        expect(result.value.rawTransactions[1]?.eventId).toMatch(/^[a-f0-9]{64}$/);

        // Verify token transaction
        expect(result.value.rawTransactions[2]).toMatchObject({
          providerName: 'alchemy',
          sourceAddress: address,
          transactionTypeHint: 'token',
          providerData: mockTokenTx,
          normalizedData: { id: mockTokenTx.hash, eventId: '2'.repeat(64) },
        });
        expect(result.value.rawTransactions[2]?.eventId).toMatch(/^[a-f0-9]{64}$/);
      }

      // Verify all three API calls were made (one for each transaction type)
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(3);

      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const [, normalOperation] = executeCalls[0]!;
      assertOperationType(normalOperation, 'getAddressTransactions');
      expect(normalOperation.address).toBe(address);
      expect(normalOperation.transactionType).toBe('normal');
      expect(normalOperation.getCacheKey).toBeDefined();

      const [, internalOperation] = executeCalls[1]!;
      assertOperationType(internalOperation, 'getAddressTransactions');
      expect(internalOperation.address).toBe(address);
      expect(internalOperation.transactionType).toBe('internal');
      expect(internalOperation.getCacheKey).toBeDefined();

      const [, tokenOperation] = executeCalls[2]!;
      assertOperationType(tokenOperation, 'getAddressTransactions');
      expect(tokenOperation.address).toBe(address);
      expect(tokenOperation.transactionType).toBe('token');
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

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch normal transactions');
      }
    });

    test('should return error if address is not provided', async () => {
      const importer = createImporter();

      const result = await consumeImportStream(importer, { sourceName: 'evm', sourceType: 'blockchain' as const });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for ethereum transaction import');
      }
    });

    test('should yield warning batch when beacon withdrawals fail', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      // Add beacon withdrawal support to mock provider
      const providers = mockProviderManager.getProviders('ethereum');
      if (providers.length > 0) {
        providers[0]!.capabilities.supportedOperations = ['getAddressTransactions'];
        providers[0]!.capabilities.supportedTransactionTypes = ['beacon_withdrawal'];
      }

      // Setup mocks: normal, internal, token succeed; beacon withdrawals fail
      setupDefaultMocks([], [], []);

      // Fourth call (beacon withdrawals) fails
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield errAsync(
          new ProviderError('Invalid API Key provided', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'ethereum',
            lastError: 'Invalid API Key provided',
          })
        );
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should have empty raw transactions (beacon withdrawals failed)
        expect(result.value.rawTransactions).toHaveLength(0);

        // Should have warning batch with valid cursor
        expect(result.value.warnings).toBeDefined();
        expect(result.value.warnings?.length).toBeGreaterThan(0);

        // Verify warning message includes helpful context
        const warning = result.value.warnings?.[0];
        expect(warning).toContain('Failed to fetch beacon withdrawals');
        expect(warning).toContain('Invalid API Key provided');
        expect(warning).toContain('ETHERSCAN_API_KEY');

        // Verify cursor structure is valid
        const beaconCursor = result.value.cursorUpdates['beacon_withdrawal'];
        expect(beaconCursor).toBeDefined();
        expect(beaconCursor?.primary.type).toBe('blockNumber');
        expect(beaconCursor?.lastTransactionId).toBe('FETCH_FAILED');
        expect(beaconCursor?.metadata?.fetchStatus).toBe('failed');
        expect(beaconCursor?.metadata?.errorMessage).toContain('Invalid API Key provided');
      }

      // Verify executeWithFailover was called 4 times (normal, internal, token, beacon_withdrawal)
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(4);

      // Verify the fourth call was for beacon withdrawals
      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;
      const [, beaconOperation] = executeCalls[3]!;
      assertOperationType(beaconOperation, 'getAddressTransactions');
      expect(beaconOperation.address).toBe(address);
      expect(beaconOperation.transactionType).toBe('beacon_withdrawal');
    });
  });

  describe('Multi-Chain Support', () => {
    test('should work with Avalanche config', async () => {
      const importer = createImporter(AVALANCHE_CONFIG);
      const address = '0x1234567890123456789012345678901234567890';

      setupDefaultMocks(
        [
          {
            raw: mockNormalTx,
            normalized: { id: mockNormalTx.hash, eventId: '0'.repeat(64), type: 'transfer' as const },
          },
        ],
        [],
        []
      );

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

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
      expect(normalOperation.transactionType).toBe('normal');

      const [, internalOperation] = executeCalls[1]!;
      assertOperationType(internalOperation, 'getAddressTransactions');
      expect(internalOperation.address).toBe(address);
      expect(internalOperation.transactionType).toBe('internal');

      const [, tokenOperation] = executeCalls[2]!;
      assertOperationType(tokenOperation, 'getAddressTransactions');
      expect(tokenOperation.address).toBe(address);
      expect(tokenOperation.transactionType).toBe('token');
    });

    test('should handle array of transactions from provider', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      const multipleNormalTxs = [
        {
          raw: mockNormalTx,
          normalized: { id: mockNormalTx.hash, eventId: '0'.repeat(64), type: 'transfer' as const },
        },
        {
          raw: { ...mockNormalTx, hash: '0x789' },
          normalized: { id: '0x789', eventId: '1'.repeat(64), type: 'transfer' as const },
        },
      ];

      setupDefaultMocks(multipleNormalTxs, [], []);

      const result = await consumeImportStream(importer, {
        sourceName: 'evm',
        sourceType: 'blockchain' as const,
        address,
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(2);
        expect(result.value.rawTransactions[0]!.providerData).toEqual(mockNormalTx);
        expect(result.value.rawTransactions[1]!.providerData).toEqual({ ...mockNormalTx, hash: '0x789' });
      }
    });
  });

  describe('Cache Key Generation', () => {
    test('should generate correct cache keys for each transaction type', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      setupDefaultMocks([], [], []);

      await consumeImportStream(importer, { sourceName: 'evm', sourceType: 'blockchain' as const, address });

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const normalCall = calls[0]![1];
      const normalCacheKey = normalCall.getCacheKey!(normalCall);
      expect(normalCacheKey).toBe('ethereum:normal:0x1234567890123456789012345678901234567890:all');

      const internalCall = calls[1]![1];
      const internalCacheKey = internalCall.getCacheKey!(internalCall);
      expect(internalCacheKey).toBe('ethereum:internal:0x1234567890123456789012345678901234567890:all');

      const tokenCall = calls[2]![1];
      const tokenCacheKey = tokenCall.getCacheKey!(tokenCall);
      expect(tokenCacheKey).toBe('ethereum:token:0x1234567890123456789012345678901234567890:all');
    });
  });
});
