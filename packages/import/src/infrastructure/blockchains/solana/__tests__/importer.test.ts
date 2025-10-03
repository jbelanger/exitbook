/**
 * Unit tests for the Solana importer
 * Tests transaction fetching with provider failover
 */

import type { BlockchainProviderManager } from '@exitbook/providers';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import type { FailoverExecutionResult } from '../../../../../../platform/providers/src/core/blockchain/index.ts';
import { ProviderError } from '../../../../../../platform/providers/src/core/blockchain/index.ts';
import { SolanaTransactionImporter } from '../importer.js';

// Mock transaction data
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

      // Mock API call to succeed
      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [mockSolTx, mockTokenTx],
          providerName: 'helius',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(2);

        // Verify SOL transaction
        expect(result.value.rawTransactions[0]).toEqual({
          metadata: {
            providerId: 'helius',
            sourceAddress: address,
          },
          rawData: mockSolTx,
        });

        // Verify token transaction
        expect(result.value.rawTransactions[1]).toEqual({
          metadata: {
            providerId: 'helius',
            sourceAddress: address,
          },
          rawData: mockTokenTx,
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

    test('should pass since parameter to API call', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';
      const since = 1234567890;

      // Mock API call to succeed
      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'helius',
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
      // Type assertion for test purposes - since is added at runtime
      expect((operation as { since?: number }).since).toBe(since);
    });

    test('should handle empty transaction list', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [],
          providerName: 'helius',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(0);
      }
    });

    test('should handle array of transactions from provider', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      const multipleTxs = [mockSolTx, { ...mockSolTx, signature: 'sig789' }, { ...mockSolTx, signature: 'sig012' }];

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: multipleTxs,
          providerName: 'helius',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

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

      // Mock provider to fail
      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        err(
          new ProviderError('Failed to fetch transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'solana',
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
        expect(result.error.message).toBe('Address required for Solana transaction import');
      }
    });
  });

  describe('Cache Key Generation', () => {
    test('should generate correct cache key with since parameter', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';
      const since = 1234567890;

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'helius',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address, since });

      // Extract getCacheKey function from the call
      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toBe('solana:raw-txs:user1111111111111111111111111111111111111111:1234567890');
    });

    test('should use "all" in cache key when since is not provided', async () => {
      const importer = createImporter();
      const address = 'user1111111111111111111111111111111111111111';

      mockProviderManager.executeWithFailover.mockResolvedValue(
        ok({
          data: [],
          providerName: 'helius',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address });

      // Extract getCacheKey function from the call
      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;

      const call = calls[0]![1];
      const cacheKey = call.getCacheKey!(call);
      expect(cacheKey).toBe('solana:raw-txs:user1111111111111111111111111111111111111111:all');
    });
  });
});
