/**
 * Unit tests for the generic Cosmos SDK importer
 * Tests the import pattern across multiple Cosmos SDK chains
 */

import type { CosmosChainConfig, BlockchainProviderManager, FailoverExecutionResult } from '@exitbook/providers';
import { ProviderError } from '@exitbook/providers';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { CosmosImporter } from '../importer.js';

// Mock chain configs
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

// Mock transaction data
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
};

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
};

type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

describe('CosmosImporter', () => {
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

      // Mock API call to succeed
      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [mockCosmosTransaction],
          providerName: 'injective-explorer',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);

        // Verify transaction metadata
        expect(result.value.rawTransactions[0]).toEqual({
          metadata: {
            providerId: 'injective-explorer',
            sourceAddress: address,
          },
          rawData: mockCosmosTransaction,
        });
      }

      // Verify API call was made
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(1);

      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const [, operation] = executeCalls[0]!;
      expect(operation.address).toBe(address);
      expect(operation.type).toBe('getRawAddressTransactions');
      expect(operation.getCacheKey).toBeDefined();
    });

    test('should handle IBC transactions', async () => {
      const importer = createImporter(OSMOSIS_CONFIG);
      const address = 'osmo1abc123def456ghi789';

      // Mock API call with IBC transaction
      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [mockIbcTransaction],
          providerName: 'mintscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);
        expect(result.value.rawTransactions[0]!.rawData).toEqual(mockIbcTransaction);
      }
    });

    test('should pass since parameter to API call', async () => {
      const importer = createImporter();
      const address = 'inj1abc123def456ghi789';
      const since = 1234567890;

      // Mock API call to succeed
      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'injective-explorer',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address, since });

      // Verify since parameter was passed
      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      expect(executeCalls).toHaveLength(1);

      const [, operation] = executeCalls[0]!;
      expect(operation.address).toBe(address);
      expect(operation.type).toBe('getRawAddressTransactions');
    });

    test('should handle multiple transactions', async () => {
      const importer = createImporter();
      const address = 'inj1abc123def456ghi789';

      const multipleTransactions = [
        mockCosmosTransaction,
        { ...mockCosmosTransaction, hash: 'tx789' },
        mockIbcTransaction,
      ];

      // Mock with array of transactions
      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: multipleTransactions,
          providerName: 'injective-explorer',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(3);
        expect(result.value.rawTransactions[0]!.rawData).toEqual(mockCosmosTransaction);
        expect(result.value.rawTransactions[1]!.rawData).toEqual({ ...mockCosmosTransaction, hash: 'tx789' });
        expect(result.value.rawTransactions[2]!.rawData).toEqual(mockIbcTransaction);
      }
    });

    test('should handle empty transaction list', async () => {
      const importer = createImporter();
      const address = 'inj1abc123def456ghi789';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [],
          providerName: 'injective-explorer',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

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

      // Mock API call to fail
      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        err(
          new ProviderError('Failed to fetch transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'injective',
          })
        )
      );

      const result = await importer.import({ address });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch transactions');
      }
    });

    test('should return error if address is not provided', async () => {
      const importer = createImporter();

      const result = await importer.import({});

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for Injective Protocol transaction import');
      }
    });

    test('should return error if address is empty string', async () => {
      const importer = createImporter();

      const result = await importer.import({ address: '' });

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

      // Mock API call to succeed
      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [mockIbcTransaction],
          providerName: 'mintscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);

      // Verify calls were made with 'osmosis' blockchain name
      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      expect(executeCalls[0]?.[0]).toBe('osmosis');

      const [, operation] = executeCalls[0]!;
      expect(operation.address).toBe(address);
      expect(operation.type).toBe('getRawAddressTransactions');
    });

    test('should generate correct error messages for different chains', async () => {
      const osmosisImporter = createImporter(OSMOSIS_CONFIG);

      const result = await osmosisImporter.import({});

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
      const since = 1234567890;

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'injective-explorer',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address, since });

      // Extract getCacheKey function from the call
      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toBe(`injective:raw-txs:${address}:${since}`);
    });

    test('should use "all" in cache key when since is not provided', async () => {
      const importer = createImporter();
      const address = 'inj1abc123def456ghi789';

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'injective-explorer',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address });

      // Extract getCacheKey function from the call
      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toBe(`injective:raw-txs:${address}:all`);
    });
  });
});
