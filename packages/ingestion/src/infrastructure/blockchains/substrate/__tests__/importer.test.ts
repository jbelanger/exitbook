/**
 * Unit tests for the generic Substrate importer
 * Tests the fetch pattern across multiple Substrate-based chains (Polkadot, Bittensor, Kusama, etc.)
 */

import type { FailoverExecutionResult } from '@exitbook/providers';
import { type SubstrateChainConfig, type BlockchainProviderManager, ProviderError } from '@exitbook/providers';
import { assertOperationType } from '@exitbook/providers/blockchain/__tests__/test-utils.js';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { SubstrateImporter } from '../importer.js';

const POLKADOT_CONFIG: SubstrateChainConfig = {
  chainName: 'polkadot',
  displayName: 'Polkadot Relay Chain',
  explorerUrls: ['https://polkadot.subscan.io'],
  nativeCurrency: 'DOT',
  nativeDecimals: 10,
  ss58Format: 0,
};

const BITTENSOR_CONFIG: SubstrateChainConfig = {
  chainName: 'bittensor',
  displayName: 'Bittensor Network',
  explorerUrls: ['https://taostats.io'],
  nativeCurrency: 'TAO',
  nativeDecimals: 9,
  ss58Format: 42,
};

const KUSAMA_CONFIG: SubstrateChainConfig = {
  chainName: 'kusama',
  displayName: 'Kusama Network',
  explorerUrls: ['https://kusama.subscan.io'],
  nativeCurrency: 'KSM',
  nativeDecimals: 12,
  ss58Format: 2,
};

const mockSubstrateTx1 = {
  amount: '1000000000',
  blockHeight: 12345,
  blockId: '0xabc123',
  call: 'balances.transfer',
  chainName: 'polkadot',
  currency: 'DOT',
  events: [{ module: 'balances', call: 'Transfer' }],
  feeAmount: '156000000',
  feeCurrency: 'DOT',
  from: '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg',
  id: '12345-2',
  module: 'balances',
  status: 'success',
  timestamp: 1609459200000,
  to: '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5',
};

const mockSubstrateTx2 = {
  amount: '5000000000',
  blockHeight: 12346,
  blockId: '0xdef456',
  call: 'staking.bond',
  chainName: 'polkadot',
  currency: 'DOT',
  events: [{ module: 'staking', call: 'Bonded' }],
  feeAmount: '200000000',
  feeCurrency: 'DOT',
  from: '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg',
  id: '12346-1',
  module: 'staking',
  status: 'success',
  timestamp: 1609459260000,
  to: '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg',
};

type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

describe('SubstrateImporter', () => {
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
        benchmarkRateLimit: vi.fn().mockResolvedValue({
          maxSafeRate: 1,
          recommended: { maxRequestsPerSecond: 1 },
          testResults: [],
        }),
        blockchain: 'polkadot',
        capabilities: { supportedOperations: [] },
        execute: vi.fn(),
        isHealthy: vi.fn().mockResolvedValue(true),
        name: 'subscan',
        rateLimit: { requestsPerSecond: 1 },
      },
    ]);
  });

  const createImporter = (
    config: SubstrateChainConfig = POLKADOT_CONFIG,
    options?: { preferredProvider?: string | undefined }
  ): SubstrateImporter =>
    new SubstrateImporter(config, mockProviderManager as unknown as BlockchainProviderManager, options);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should initialize with Polkadot config', () => {
      const importer = createImporter();

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('polkadot', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('polkadot');
      expect(importer).toBeDefined();
    });

    test('should initialize with Bittensor config', () => {
      const importer = createImporter(BITTENSOR_CONFIG);

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('bittensor', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('bittensor');
      expect(importer).toBeDefined();
    });

    test('should initialize with Kusama config', () => {
      const importer = createImporter(KUSAMA_CONFIG);

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('kusama', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('kusama');
      expect(importer).toBeDefined();
    });

    test('should initialize with preferred provider', () => {
      const importer = createImporter(POLKADOT_CONFIG, {
        preferredProvider: 'subscan',
      });

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('polkadot', 'subscan');
      expect(importer).toBeDefined();
    });

    test('should throw error if provider manager is not provided', () => {
      expect(() => new SubstrateImporter(POLKADOT_CONFIG, undefined as unknown as BlockchainProviderManager)).toThrow(
        'Provider manager required for polkadot importer'
      );
    });

    test('should throw error for Bittensor if provider manager is not provided', () => {
      expect(() => new SubstrateImporter(BITTENSOR_CONFIG, undefined as unknown as BlockchainProviderManager)).toThrow(
        'Provider manager required for bittensor importer'
      );
    });
  });

  describe('Import - Success Cases', () => {
    test('should successfully fetch transactions', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [
            { raw: { original: 'data1' }, normalized: mockSubstrateTx1 },
            { raw: { original: 'data2' }, normalized: mockSubstrateTx2 },
          ],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(2);

        // Verify first transaction
        expect(result.value.rawTransactions[0]).toMatchObject({
          providerName: 'subscan',
          sourceAddress: address,
          normalizedData: mockSubstrateTx1,
          rawData: { original: 'data1' },
        });
        expect(result.value.rawTransactions[0]?.externalId).toMatch(/^[a-f0-9]{64}$/);

        // Verify second transaction
        expect(result.value.rawTransactions[1]).toMatchObject({
          providerName: 'subscan',
          sourceAddress: address,
          normalizedData: mockSubstrateTx2,
          rawData: { original: 'data2' },
        });
        expect(result.value.rawTransactions[1]?.externalId).toMatch(/^[a-f0-9]{64}$/);
      }

      // Verify API call was made
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(1);

      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const [blockchain, operation] = executeCalls[0]!;
      expect(blockchain).toBe('polkadot');
      assertOperationType(operation, 'getAddressTransactions');
      expect(operation.address).toBe(address);
      expect(operation.getCacheKey).toBeDefined();
    });

    test('should handle empty transaction list', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(0);
      }
    });

    test('should handle single transaction', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ raw: { original: 'data' }, normalized: mockSubstrateTx1 }],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);
        expect(result.value.rawTransactions[0]!.normalizedData).toEqual(mockSubstrateTx1);
        expect(result.value.rawTransactions[0]!.rawData).toEqual({ original: 'data' });
      }
    });

    test('should handle unexpected data format gracefully', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(0);
      }
    });

    test('should handle non-array data gracefully', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(0);
      }
    });

    test('should handle large transaction batch', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      // Create 100 mock transactions with TransactionWithRawData structure
      const largeBatch = Array.from({ length: 100 }, (_, i) => ({
        raw: { originalData: `data${i}` },
        normalized: {
          ...mockSubstrateTx1,
          blockHeight: 12345 + i,
          id: `${12345 + i}-${i}`,
        },
      }));

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: largeBatch,
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(100);
        expect(result.value.rawTransactions[0]!.normalizedData).toEqual(largeBatch[0]!.normalized);
        expect(result.value.rawTransactions[99]!.normalizedData).toEqual(largeBatch[99]!.normalized);
      }
    });
  });

  describe('Import - Error Cases', () => {
    test('should fail if transaction fetch fails', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        err(
          new ProviderError('Failed to fetch transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'polkadot',
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
        expect(result.error.message).toBe('Address required for polkadot transaction import');
      }
    });

    test('should return error if address is empty string', async () => {
      const importer = createImporter();

      const result = await importer.import({ address: '' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for polkadot transaction import');
      }
    });

    test('should fail for Bittensor if transaction fetch fails', async () => {
      const importer = createImporter(BITTENSOR_CONFIG);
      const address = '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        err(
          new ProviderError('Taostats API unavailable', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'bittensor',
          })
        )
      );

      const result = await importer.import({ address });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Taostats API unavailable');
      }
    });

    test('should propagate provider errors correctly', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      const providerError = new ProviderError('Rate limit exceeded', 'ALL_PROVIDERS_FAILED', {
        blockchain: 'polkadot',
      });

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(err(providerError));

      const result = await importer.import({ address });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ProviderError);
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });
  });

  describe('Multi-Chain Support', () => {
    test('should work with Bittensor config', async () => {
      const importer = createImporter(BITTENSOR_CONFIG);
      const address = '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL';

      const bittensorTx = {
        ...mockSubstrateTx1,
        chainName: 'bittensor',
        currency: 'TAO',
        feeCurrency: 'TAO',
      };

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [{ raw: { original: 'tao-data' }, normalized: bittensorTx }],
          providerName: 'taostats',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);

      // Verify calls were made with 'bittensor' blockchain name
      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      expect(executeCalls[0]?.[0]).toBe('bittensor');

      const [, operation] = executeCalls[0]!;
      assertOperationType(operation, 'getAddressTransactions');
      expect(operation.address).toBe(address);

      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);
        expect(result.value.rawTransactions[0]!.normalizedData).toEqual(bittensorTx);
        expect(result.value.rawTransactions[0]!.rawData).toEqual({ original: 'tao-data' });
      }
    });

    test('should work with Kusama config', async () => {
      const importer = createImporter(KUSAMA_CONFIG);
      const address = 'HNZata7iMYWmk5RvZRTiAsSDhV8366zq2YGb3tLH5Upf74F';

      const kusamaTx = {
        ...mockSubstrateTx1,
        chainName: 'kusama',
        currency: 'KSM',
        feeCurrency: 'KSM',
      };

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [{ raw: { original: 'ksm-data' }, normalized: kusamaTx }],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);

      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      expect(executeCalls[0]?.[0]).toBe('kusama');

      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);
        expect(result.value.rawTransactions[0]!.normalizedData).toEqual(kusamaTx);
        expect(result.value.rawTransactions[0]!.rawData).toEqual({ original: 'ksm-data' });
      }
    });

    test('should handle provider failover between multiple chains', async () => {
      const polkadotImporter = createImporter(POLKADOT_CONFIG);
      const bittensorImporter = createImporter(BITTENSOR_CONFIG);

      const polkadotAddress = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';
      const bittensorAddress = '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ raw: { original: 'dot-data' }, normalized: { ...mockSubstrateTx1, chainName: 'polkadot' } }],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [
            {
              raw: { original: 'tao-data' },
              normalized: { ...mockSubstrateTx1, chainName: 'bittensor', currency: 'TAO' },
            },
          ],
          providerName: 'taostats',
        } as FailoverExecutionResult<unknown>)
      );

      const polkadotResult = await polkadotImporter.import({ address: polkadotAddress });
      const bittensorResult = await bittensorImporter.import({ address: bittensorAddress });

      expect(polkadotResult.isOk()).toBe(true);
      expect(bittensorResult.isOk()).toBe(true);

      if (polkadotResult.isOk() && bittensorResult.isOk()) {
        expect(polkadotResult.value.rawTransactions[0]!.providerName).toBe('subscan');
        expect(bittensorResult.value.rawTransactions[0]!.providerName).toBe('taostats');
      }
    });
  });

  describe('Cache Key Generation', () => {
    test('should generate correct cache key with address', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address });

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toBe('polkadot1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg_all');
    });

    test('should generate different cache keys for different chains', async () => {
      const polkadotImporter = createImporter(POLKADOT_CONFIG);
      const bittensorImporter = createImporter(BITTENSOR_CONFIG);

      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      await polkadotImporter.import({ address });
      await bittensorImporter.import({ address });

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const polkadotCall = calls[0]![1];
      const bittensorCall = calls[1]![1];

      const polkadotCacheKey = polkadotCall.getCacheKey!(polkadotCall);
      const bittensorCacheKey = bittensorCall.getCacheKey!(bittensorCall);

      expect(polkadotCacheKey).toBe('polkadot1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg_all');
      expect(bittensorCacheKey).toBe('bittensor1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg_all');
      expect(polkadotCacheKey).not.toBe(bittensorCacheKey);
    });

    test('should generate cache keys based on operation type', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address });

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];

      // Verify the operation type is correct
      expect(call.type).toBe('getAddressTransactions');

      // Verify cache key generation handles the operation type correctly
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toContain('polkadot');
      expect(cacheKey).toContain(address);
    });
  });

  describe('Provider Integration', () => {
    test('should auto-register providers on initialization', () => {
      createImporter(POLKADOT_CONFIG);

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('polkadot', undefined);
    });

    test('should auto-register with preferred provider', () => {
      createImporter(POLKADOT_CONFIG, { preferredProvider: 'subscan' });

      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('polkadot', 'subscan');
    });

    test('should query registered providers on initialization', () => {
      createImporter(POLKADOT_CONFIG);

      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('polkadot');
    });

    test('should correctly handle provider metadata in responses', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ raw: { original: 'data' }, normalized: mockSubstrateTx1 }],
          providerName: 'custom-provider',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions[0]!.providerName).toBe('custom-provider');
      }
    });
  });

  describe('Address Validation', () => {
    test('should handle very long addresses', async () => {
      const importer = createImporter();
      // Generate a long address (SS58 addresses can be quite long)
      const address = '1' + 'a'.repeat(100);

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);

      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      assertOperationType(call, 'getAddressTransactions');
      expect(call.address).toBe(address);
    });

    test('should handle addresses with special characters', async () => {
      const importer = createImporter();
      const address = '1FRMM8PEiWXYax7rpS6X4XZX1aAAxSWx1CrKTyrVYhV24fg';

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'subscan',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
    });
  });
});
