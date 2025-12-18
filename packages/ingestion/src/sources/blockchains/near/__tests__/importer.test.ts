/**
 * Unit tests for the NEAR importer
 * Tests transaction fetching with provider failover
 */
import { type BlockchainProviderManager, ProviderError } from '@exitbook/blockchain-providers';
import { assertOperationType } from '@exitbook/blockchain-providers/blockchain/__tests__/test-utils.js';
import { errAsync, okAsync } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  assertOk,
  consumeImportStream,
  createMockProviderManager,
  type ProviderManagerMock,
} from '../../../../shared/test-utils/importer-test-utils.js';
import { NearTransactionImporter } from '../importer.js';

const mockNearTx = {
  id: 'AbCdEf123456',
  from: 'alice.near',
  to: 'bob.near',
  amount: '1000000000000000000000000', // 1 NEAR in yoctoNEAR
  currency: 'NEAR',
  timestamp: 1640000000,
  status: 'success',
  feeAmount: '0.005',
  feeCurrency: 'NEAR',
};

const mockNearFunctionCallTx = {
  id: 'FunctionCallTx456',
  from: 'alice.near',
  to: 'usdt.tether-token.near',
  amount: '1',
  currency: 'NEAR',
  timestamp: 1640000001,
  status: 'success',
  feeAmount: '0.003',
  feeCurrency: 'NEAR',
  actions: [
    {
      actionType: 'FUNCTION_CALL',
      methodName: 'ft_transfer',
      receiverId: 'usdt.tether-token.near',
      deposit: '1',
    },
  ],
};

describe('NearTransactionImporter', () => {
  let mockProviderManager: ProviderManagerMock;

  /**
   * Helper to setup default mocks for both normal and token transaction calls
   */
  const setupDefaultMocks = (normalData: unknown[] = [], tokenData: unknown[] = []) => {
    mockProviderManager.executeWithFailover
      .mockImplementationOnce(async function* () {
        yield okAsync({
          data: normalData,
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: normalData.length,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      })
      .mockImplementationOnce(async function* () {
        yield okAsync({
          data: tokenData,
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: tokenData.length,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      });
  };

  beforeEach(() => {
    mockProviderManager = createMockProviderManager('near');

    // Default mock: return empty arrays for both calls (tests can override as needed)
    mockProviderManager.executeWithFailover.mockImplementation(async function* () {
      yield okAsync({
        data: [],
        providerName: 'nearblocks',
        cursor: {
          primary: { type: 'blockNumber' as const, value: 0 },
          lastTransactionId: '',
          totalFetched: 0,
          metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
        },
      });
    });
  });
  const createImporter = (options?: { preferredProvider?: string | undefined }): NearTransactionImporter =>
    new NearTransactionImporter(mockProviderManager as unknown as BlockchainProviderManager, options);
  afterEach(() => {
    vi.clearAllMocks();
  });
  describe('Constructor', () => {
    test('should initialize with NEAR provider manager', () => {
      const importer = createImporter();
      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('near', undefined);
      expect(mockProviderManager.getProviders).toHaveBeenCalledWith('near');
      expect(importer).toBeDefined();
    });
    test('should initialize with preferred provider', () => {
      const importer = createImporter({
        preferredProvider: 'nearblocks',
      });
      expect(mockProviderManager.autoRegisterFromConfig).toHaveBeenCalledWith('near', 'nearblocks');
      expect(importer).toBeDefined();
    });
    test('should throw error if provider manager is not provided', () => {
      expect(() => new NearTransactionImporter(undefined as unknown as BlockchainProviderManager)).toThrow(
        'Provider manager required for NEAR importer'
      );
    });
  });
  describe('Import - Success Cases', () => {
    test('should successfully fetch transactions', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      const mockNormalizedTransfer = mockNearTx;
      const mockNormalizedFunctionCall = mockNearFunctionCallTx;
      // Mock normal transactions call
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield okAsync({
          data: [
            { normalized: mockNormalizedTransfer, raw: { transaction_hash: 'AbCdEf123456' } },
            { normalized: mockNormalizedFunctionCall, raw: { transaction_hash: 'FunctionCallTx456' } },
          ],
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 2,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      });
      // Mock token transactions call
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield okAsync({
          data: [],
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 0,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });

      const value = assertOk(result);
      expect(value.rawTransactions).toHaveLength(2);
      // Verify transfer transaction
      expect(value.rawTransactions[0]).toMatchObject({
        providerName: 'nearblocks',
        sourceAddress: address,
        normalizedData: mockNormalizedTransfer,
        providerData: { transaction_hash: 'AbCdEf123456' },
        transactionTypeHint: 'normal',
      });
      expect(value.rawTransactions[0]?.eventId).toMatch(/^[a-f0-9]{64}$/);
      // Verify function call transaction
      expect(value.rawTransactions[1]).toMatchObject({
        providerName: 'nearblocks',
        sourceAddress: address,
        normalizedData: mockNormalizedFunctionCall,
        providerData: { transaction_hash: 'FunctionCallTx456' },
        transactionTypeHint: 'normal',
      });
      expect(value.rawTransactions[1]?.eventId).toMatch(/^[a-f0-9]{64}$/);
      // Verify API calls were made (normal + token)
      expect(mockProviderManager.executeWithFailover).toHaveBeenCalledTimes(2);
      const executeCalls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;
      const [, normalOperation] = executeCalls[0]!;
      assertOperationType(normalOperation, 'getAddressTransactions');
      expect(normalOperation.address).toBe(address);
      expect(normalOperation.getCacheKey).toBeDefined();
      const [, tokenOperation] = executeCalls[1]!;
      assertOperationType(tokenOperation, 'getAddressTokenTransactions');
      expect(tokenOperation.address).toBe(address);
      expect(tokenOperation.getCacheKey).toBeDefined();
    });
    test('should handle empty transaction list', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      setupDefaultMocks([], []);
      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });
      const value = assertOk(result);
      expect(value.rawTransactions).toHaveLength(0);
    });
    test('should handle array of transactions from provider', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      const tx1 = mockNearTx;
      const tx2 = { ...mockNearTx, id: 'Tx789' };
      const tx3 = { ...mockNearTx, id: 'Tx012' };
      const multipleTxs = [
        { normalized: tx1, raw: { transaction_hash: 'AbCdEf123456' } },
        { normalized: tx2, raw: { transaction_hash: 'Tx789' } },
        { normalized: tx3, raw: { transaction_hash: 'Tx012' } },
      ];
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield okAsync({
          data: multipleTxs,
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 3,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      });
      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });
      const value = assertOk(result);
      expect(value.rawTransactions).toHaveLength(3);
      expect(value.rawTransactions[0]!.providerData).toEqual({ transaction_hash: 'AbCdEf123456' });
      expect(value.rawTransactions[1]!.providerData).toEqual({ transaction_hash: 'Tx789' });
      expect(value.rawTransactions[2]!.providerData).toEqual({ transaction_hash: 'Tx012' });
    });
    test('should handle implicit account addresses', async () => {
      const importer = createImporter();
      const implicitAddress = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';
      const mockNormalizedTx = { ...mockNearTx, from: implicitAddress };
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield okAsync({
          data: [{ normalized: mockNormalizedTx, raw: { transaction_hash: 'ImplicitTx' } }],
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 1,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      });
      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address: implicitAddress,
      });
      const value = assertOk(result);
      expect(value.rawTransactions).toHaveLength(1);
      expect(value.rawTransactions[0]?.sourceAddress).toBe(implicitAddress);
    });
    test('should handle sub-account addresses', async () => {
      const importer = createImporter();
      const subAccount = 'sub.alice.near';
      const mockNormalizedTx = { ...mockNearTx, from: subAccount };
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield okAsync({
          data: [{ normalized: mockNormalizedTx, raw: { transaction_hash: 'SubAccountTx' } }],
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 1,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      });
      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address: subAccount,
      });
      const value = assertOk(result);
      expect(value.rawTransactions).toHaveLength(1);
      expect(value.rawTransactions[0]?.sourceAddress).toBe(subAccount);
    });
  });
  describe('Import - Error Cases', () => {
    test('should fail if normal transactions provider fails', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield errAsync(
          new ProviderError('Failed to fetch transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'near',
          })
        );
      });
      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch transactions');
      }
    });
    test('should fail if token transactions provider fails', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      // Normal transactions succeed
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield okAsync({
          data: [],
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 0,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      });
      // Token transactions fail
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield errAsync(
          new ProviderError('Failed to fetch token transactions', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'near',
          })
        );
      });
      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Failed to fetch token transactions');
      }
    });
    test('should return error if address is not provided', async () => {
      const importer = createImporter();
      const result = await consumeImportStream(importer, { sourceName: 'near', sourceType: 'blockchain' as const });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Address required for NEAR transaction import');
      }
    });
    test('should fail with network timeout error', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield errAsync(
          new ProviderError('Network timeout', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'near',
            lastError: 'Network timeout',
          })
        );
      });
      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Network timeout');
      }
    });
    test('should fail with rate limit error', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield errAsync(
          new ProviderError('Rate limit exceeded', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'near',
            lastError: 'Rate limit exceeded',
          })
        );
      });
      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });
  });
  describe('Cache Key Generation', () => {
    test('should generate correct cache keys for named accounts', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      await consumeImportStream(importer, { sourceName: 'near', sourceType: 'blockchain' as const, address });
      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;
      // First call is for normal transactions
      const normalCall = calls[0]![1];
      const normalCacheKey = normalCall.getCacheKey!(normalCall);
      expect(normalCacheKey).toBe('near:normal-txs:alice.near:all');
      // Second call is for token transactions
      const tokenCall = calls[1]![1];
      const tokenCacheKey = tokenCall.getCacheKey!(tokenCall);
      expect(tokenCacheKey).toBe('near:token-txs:alice.near:all');
    });
    test('should generate correct cache keys for implicit accounts', async () => {
      const importer = createImporter();
      const address = '98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de';
      await consumeImportStream(importer, { sourceName: 'near', sourceType: 'blockchain' as const, address });
      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;
      const normalCall = calls[0]![1];
      const normalCacheKey = normalCall.getCacheKey!(normalCall);
      expect(normalCacheKey).toBe(`near:normal-txs:${address}:all`);
      const tokenCall = calls[1]![1];
      const tokenCacheKey = tokenCall.getCacheKey!(tokenCall);
      expect(tokenCacheKey).toBe(`near:token-txs:${address}:all`);
    });
    test('should generate correct cache keys for sub-accounts', async () => {
      const importer = createImporter();
      const address = 'token.sub.alice.near';
      await consumeImportStream(importer, { sourceName: 'near', sourceType: 'blockchain' as const, address });
      const calls: Parameters<BlockchainProviderManager['executeWithFailover']>[] =
        mockProviderManager.executeWithFailover.mock.calls;
      const normalCall = calls[0]![1];
      const normalCacheKey = normalCall.getCacheKey!(normalCall);
      expect(normalCacheKey).toBe('near:normal-txs:token.sub.alice.near:all');
      const tokenCall = calls[1]![1];
      const tokenCacheKey = tokenCall.getCacheKey!(tokenCall);
      expect(tokenCacheKey).toBe('near:token-txs:token.sub.alice.near:all');
    });
  });
  describe('Transaction ID Generation', () => {
    test('should generate unique transaction IDs', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      const tx1 = { ...mockNearTx, id: 'Tx1' };
      const tx2 = { ...mockNearTx, id: 'Tx2' };
      mockProviderManager.executeWithFailover.mockImplementationOnce(async function* () {
        yield okAsync({
          data: [
            { normalized: tx1, raw: { transaction_hash: 'Tx1' } },
            { normalized: tx2, raw: { transaction_hash: 'Tx2' } },
          ],
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 2,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      });

      const result = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });
      const value = assertOk(result);

      const id1 = value.rawTransactions[0]?.eventId;
      const id2 = value.rawTransactions[1]?.eventId;
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2); // Should be unique
      expect(id1).toMatch(/^[a-f0-9]{64}$/);
      expect(id2).toMatch(/^[a-f0-9]{64}$/);
    });
    test('should generate consistent IDs for same transaction', async () => {
      const importer = createImporter();
      const address = 'alice.near';
      mockProviderManager.executeWithFailover.mockImplementation(async function* () {
        yield okAsync({
          data: [{ normalized: mockNearTx, raw: { transaction_hash: 'AbCdEf123456' } }],
          providerName: 'nearblocks',
          cursor: {
            primary: { type: 'blockNumber' as const, value: 0 },
            lastTransactionId: '',
            totalFetched: 1,
            metadata: { providerName: 'nearblocks', updatedAt: Date.now(), isComplete: true },
          },
        });
      });
      const result1 = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });
      const result2 = await consumeImportStream(importer, {
        sourceName: 'near',
        sourceType: 'blockchain' as const,
        address,
      });
      const value1 = assertOk(result1);
      const value2 = assertOk(result2);

      const id1 = value1.rawTransactions[0]?.eventId;
      const id2 = value2.rawTransactions[0]?.eventId;
      expect(id1).toBe(id2); // Should be consistent
    });
  });
});
