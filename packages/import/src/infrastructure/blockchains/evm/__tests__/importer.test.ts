/**
 * Unit tests for the generic EVM importer
 * Tests the three-method fetch pattern (normal, internal, token) across multiple chains
 */

import {
  ProviderError,
  type BlockchainProviderManager,
  type EvmChainConfig,
  type FailoverExecutionResult,
} from '@exitbook/providers';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { EvmImporter } from '../importer.js';

// Mock chain configs
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

// Mock transaction data
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

  beforeEach(() => {
    // Create a mock provider manager
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

      // Mock all three API calls to succeed
      mockProviderManager.executeWithFailover
        .mockResolvedValueOnce(
          ok({
            data: [mockNormalTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        )
        .mockResolvedValueOnce(
          ok({
            data: [mockInternalTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        )
        .mockResolvedValueOnce(
          ok({
            data: [mockTokenTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(3);

        // Verify normal transaction
        expect(result.value.rawTransactions[0]).toEqual({
          metadata: {
            providerId: 'alchemy',
            sourceAddress: address,
            transactionType: 'normal',
          },
          rawData: mockNormalTx,
        });

        // Verify internal transaction
        expect(result.value.rawTransactions[1]).toEqual({
          metadata: {
            providerId: 'alchemy',
            sourceAddress: address,
            transactionType: 'internal',
          },
          rawData: mockInternalTx,
        });

        // Verify token transaction
        expect(result.value.rawTransactions[2]).toEqual({
          metadata: {
            providerId: 'alchemy',
            sourceAddress: address,
            transactionType: 'token',
          },
          rawData: mockTokenTx,
        });
      }

      // Verify all three API calls were made in parallel
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(3);

      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const [, normalOperation] = executeCalls[0]!;
      expect(normalOperation.address).toBe(address);
      expect(normalOperation.type).toBe('getRawAddressTransactions');
      expect(normalOperation.getCacheKey).toBeDefined();

      const [, internalOperation] = executeCalls[1]!;
      expect(internalOperation.address).toBe(address);
      expect(internalOperation.type).toBe('getRawAddressInternalTransactions');
      expect(internalOperation.getCacheKey).toBeDefined();

      const [, tokenOperation] = executeCalls[2]!;
      expect(tokenOperation.address).toBe(address);
      expect(tokenOperation.type).toBe('getTokenTransactions');
      expect(tokenOperation.getCacheKey).toBeDefined();
    });

    test('should handle graceful failure of internal transactions', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      // Mock normal and token to succeed, internal to fail
      mockProviderManager.executeWithFailover
        .mockResolvedValueOnce(
          ok({
            data: [mockNormalTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        )
        .mockResolvedValueOnce(
          err(
            new ProviderError('No internal transactions available', 'ALL_PROVIDERS_FAILED', {
              blockchain: 'ethereum',
            })
          )
        )
        .mockResolvedValueOnce(
          ok({
            data: [mockTokenTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should have normal and token, but not internal
        expect(result.value.rawTransactions).toHaveLength(2);
        expect(result.value.rawTransactions[0]!.metadata.transactionType).toBe('normal');
        expect(result.value.rawTransactions[1]!.metadata.transactionType).toBe('token');
      }
    });

    test('should handle graceful failure of token transactions', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      // Mock normal and internal to succeed, token to fail
      mockProviderManager.executeWithFailover
        .mockResolvedValueOnce(
          ok({
            data: [mockNormalTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        )
        .mockResolvedValueOnce(
          ok({
            data: [mockInternalTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        )
        .mockResolvedValueOnce(
          err(
            new ProviderError('No token transactions available', 'ALL_PROVIDERS_FAILED', {
              blockchain: 'ethereum',
            })
          )
        );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should have normal and internal, but not token
        expect(result.value.rawTransactions).toHaveLength(2);
        expect(result.value.rawTransactions[0]!.metadata.transactionType).toBe('normal');
        expect(result.value.rawTransactions[1]!.metadata.transactionType).toBe('internal');
      }
    });

    test('should handle graceful failure of both internal and token transactions', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      // Mock only normal to succeed
      mockProviderManager.executeWithFailover
        .mockResolvedValueOnce(
          ok({
            data: [mockNormalTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        )
        .mockResolvedValueOnce(
          err(
            new ProviderError('No internal transactions available', 'ALL_PROVIDERS_FAILED', {
              blockchain: 'ethereum',
            })
          )
        )
        .mockResolvedValueOnce(
          err(
            new ProviderError('No token transactions available', 'ALL_PROVIDERS_FAILED', {
              blockchain: 'ethereum',
            })
          )
        );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Should have only normal transactions
        expect(result.value.rawTransactions).toHaveLength(1);
        expect(result.value.rawTransactions[0]!.metadata.transactionType).toBe('normal');
      }
    });

    test('should pass since parameter to all API calls', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';
      const since = 1234567890;

      // Mock all three API calls to succeed
      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'alchemy',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address, since });

      // Verify since parameter was passed to all three calls
      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      expect(executeCalls).toHaveLength(3);

      const [, normalOperation] = executeCalls[0]!;
      expect(normalOperation.address).toBe(address);
      expect(normalOperation.type).toBe('getRawAddressTransactions');

      const [, internalOperation] = executeCalls[1]!;
      expect(internalOperation.address).toBe(address);
      expect(internalOperation.type).toBe('getRawAddressInternalTransactions');

      const [, tokenOperation] = executeCalls[2]!;
      expect(tokenOperation.address).toBe(address);
      expect(tokenOperation.type).toBe('getTokenTransactions');
    });
  });

  describe('Import - Error Cases', () => {
    test('should fail if normal transactions fail', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      // Mock normal transactions to fail
      mockProviderManager.executeWithFailover
        .mockResolvedValueOnce(
          err(
            new ProviderError('Failed to fetch normal transactions', 'ALL_PROVIDERS_FAILED', {
              blockchain: 'ethereum',
            })
          )
        )
        .mockResolvedValueOnce(
          ok({
            data: [mockInternalTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        )
        .mockResolvedValueOnce(
          ok({
            data: [mockTokenTx],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        );

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

      // Mock all three API calls to succeed
      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [mockNormalTx],
          providerName: 'snowtrace',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);

      // Verify calls were made with 'avalanche' blockchain name
      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      expect(executeCalls[0]?.[0]).toBe('avalanche');
      expect(executeCalls[1]?.[0]).toBe('avalanche');
      expect(executeCalls[2]?.[0]).toBe('avalanche');

      const [, normalOperation] = executeCalls[0]!;
      expect(normalOperation.address).toBe(address);
      expect(normalOperation.type).toBe('getRawAddressTransactions');

      const [, internalOperation] = executeCalls[1]!;
      expect(internalOperation.address).toBe(address);
      expect(internalOperation.type).toBe('getRawAddressInternalTransactions');

      const [, tokenOperation] = executeCalls[2]!;
      expect(tokenOperation.address).toBe(address);
      expect(tokenOperation.type).toBe('getTokenTransactions');
    });

    test('should handle array of transactions from provider', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      const multipleNormalTxs = [mockNormalTx, { ...mockNormalTx, hash: '0x789' }];

      // Mock with array of transactions
      mockProviderManager.executeWithFailover
        .mockResolvedValueOnce(
          ok({
            data: multipleNormalTxs,
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        )
        .mockResolvedValueOnce(
          ok({
            data: [],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        )
        .mockResolvedValueOnce(
          ok({
            data: [],
            providerName: 'alchemy',
          } as FailoverExecutionResult<unknown>)
        );

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
      const since = 1234567890;

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'alchemy',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address, since });

      // Extract getCacheKey functions from the calls
      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      // Test normal transactions cache key
      const normalCall = calls[0]![1];
      const normalCacheKey = normalCall.getCacheKey!(normalCall);
      expect(normalCacheKey).toBe('ethereum:normal-txs:0x1234567890123456789012345678901234567890:1234567890');

      // Test internal transactions cache key
      const internalCall = calls[1]![1];
      const internalCacheKey = internalCall.getCacheKey!(internalCall);
      expect(internalCacheKey).toBe('ethereum:internal-txs:0x1234567890123456789012345678901234567890:1234567890');

      // Test token transactions cache key
      const tokenCall = calls[2]![1];
      const tokenCacheKey = tokenCall.getCacheKey!(tokenCall);
      expect(tokenCacheKey).toBe('ethereum:token-txs:0x1234567890123456789012345678901234567890:1234567890');
    });

    test('should use "all" in cache key when since is not provided', async () => {
      const importer = createImporter();
      const address = '0x1234567890123456789012345678901234567890';

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'alchemy',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address });

      // Extract getCacheKey functions from the calls
      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const normalCall = calls[0]![1];
      const normalCacheKey = normalCall.getCacheKey!(normalCall);
      expect(normalCacheKey).toBe('ethereum:normal-txs:0x1234567890123456789012345678901234567890:all');
    });
  });
});
