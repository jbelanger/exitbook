/**
 * Unit tests for NEAR importer enrichment functionality
 * Tests transaction enrichment with account changes and token transfers
 */

import type {
  BlockchainProviderManager,
  FailoverExecutionResult,
  NearBlocksActivity,
  NearBlocksFtTransaction,
  NearBlocksReceipt,
  NearTransaction,
  TransactionWithRawData,
} from '@exitbook/providers';
import { ProviderError } from '@exitbook/providers';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, test, vi, type Mocked } from 'vitest';

import { NearTransactionImporter } from '../importer.js';

const mockBaseTx: NearTransaction = {
  amount: '1000000000000000000000000',
  currency: 'NEAR',
  from: 'alice.near',
  id: 'tx123',
  providerName: 'nearblocks',
  status: 'success',
  timestamp: 1640000000000,
  to: 'bob.near',
};

const mockReceipts: NearBlocksReceipt[] = [
  {
    originated_from_transaction_hash: 'tx123',
    predecessor_account_id: 'alice.near',
    receipt_id: 'receipt123',
    receiver_account_id: 'bob.near',
  },
];

const mockActivities: NearBlocksActivity[] = [
  {
    absolute_nonstaked_amount: '1000000000000000000000000',
    block_timestamp: '1640000000000000000',
    direction: 'OUTBOUND',
    receipt_id: 'receipt123',
  },
];

const mockFtTransactions: NearBlocksFtTransaction[] = [
  {
    affected_account_id: 'alice.near',
    block_timestamp: '1640000000000000000',
    delta_amount: '1000000',
    ft: {
      contract: 'usdc.near',
      decimals: 6,
      symbol: 'USDC',
    },
    receipt_id: 'receipt123',
    transaction_hash: 'tx123',
  },
];

type ProviderManagerMock = Mocked<
  Pick<BlockchainProviderManager, 'autoRegisterFromConfig' | 'executeWithFailover' | 'getProviders'>
>;

describe('NearTransactionImporter - Enrichment', () => {
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
        blockchain: 'near',
      },
    ] as never[]);
  });

  const createImporter = (options?: { preferredProvider?: string | undefined }): NearTransactionImporter =>
    new NearTransactionImporter(mockProviderManager as unknown as BlockchainProviderManager, options);

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Enrichment Data Fetching', () => {
    test('should fetch enrichment data from all 4 endpoints', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const mockProvider = {
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok(mockFtTransactions)),
        getAccountActivities: vi.fn().mockResolvedValue(ok(mockActivities)),
        getAccountReceipts: vi.fn().mockResolvedValue(ok(mockReceipts)),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      expect(mockProvider.getAccountReceipts).toHaveBeenCalled();
      expect(mockProvider.getAccountActivities).toHaveBeenCalled();
      expect(mockProvider.getAccountFtTransactions).toHaveBeenCalled();
    });

    test('should handle pagination for receipts', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const page1Receipts = Array(50).fill(mockReceipts[0]);
      const page2Receipts = Array(30).fill({ ...mockReceipts[0], receipt_id: 'receipt456' });

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok([])),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok([])),
        getAccountReceipts: vi.fn().mockResolvedValueOnce(ok(page1Receipts)).mockResolvedValueOnce(ok(page2Receipts)),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address });

      expect(mockProvider.getAccountReceipts).toHaveBeenCalledTimes(2);
    });

    test('should handle pagination for activities', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const page1Activities = Array(50).fill(mockActivities[0]);
      const page2Activities = Array(20).fill({ ...mockActivities[0], receipt_id: 'receipt456' });

      const mockProvider = {
        getAccountActivities: vi
          .fn()
          .mockResolvedValueOnce(ok(page1Activities))
          .mockResolvedValueOnce(ok(page2Activities)),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok([])),
        getAccountReceipts: vi.fn().mockResolvedValue(ok([])),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address });

      expect(mockProvider.getAccountActivities).toHaveBeenCalledTimes(2);
    });

    test('should handle pagination for FT transactions', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const page1FtTxs = Array(50).fill(mockFtTransactions[0]);
      const page2FtTxs = Array(15).fill({ ...mockFtTransactions[0], receipt_id: 'receipt789' });

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok([])),
        getAccountFtTransactions: vi.fn().mockResolvedValueOnce(ok(page1FtTxs)).mockResolvedValueOnce(ok(page2FtTxs)),
        getAccountReceipts: vi.fn().mockResolvedValue(ok([])),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      await importer.import({ address });

      expect(mockProvider.getAccountFtTransactions).toHaveBeenCalledTimes(2);
    });
  });

  describe('Index Building', () => {
    test('should build indexes correctly from enrichment data', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const multipleReceipts: NearBlocksReceipt[] = [
        {
          originated_from_transaction_hash: 'tx123',
          predecessor_account_id: 'alice.near',
          receipt_id: 'receipt1',
          receiver_account_id: 'bob.near',
        },
        {
          originated_from_transaction_hash: 'tx123',
          predecessor_account_id: 'bob.near',
          receipt_id: 'receipt2',
          receiver_account_id: 'alice.near',
        },
        {
          originated_from_transaction_hash: 'tx456',
          predecessor_account_id: 'alice.near',
          receipt_id: 'receipt3',
          receiver_account_id: 'charlie.near',
        },
      ];

      const multipleActivities: NearBlocksActivity[] = [
        {
          absolute_nonstaked_amount: '1000000000000000000000000',
          block_timestamp: '1640000000000000000',
          direction: 'OUTBOUND',
          receipt_id: 'receipt1',
        },
        {
          absolute_nonstaked_amount: '500000000000000000000000',
          block_timestamp: '1640000000000000000',
          direction: 'INBOUND',
          receipt_id: 'receipt2',
        },
      ];

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok(multipleActivities)),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok(mockFtTransactions)),
        getAccountReceipts: vi.fn().mockResolvedValue(ok(multipleReceipts)),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      const baseTxs: TransactionWithRawData<NearTransaction>[] = [
        { normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } },
      ];

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: baseTxs,
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const enrichedTx = result.value.rawTransactions[0];
        expect(enrichedTx?.normalizedData).toBeDefined();
        // The transaction should have account changes from activities linked via receipts
        const typedNormalized = enrichedTx?.normalizedData as NearTransaction;
        expect(typedNormalized.accountChanges).toBeDefined();
        expect(typedNormalized.accountChanges).toHaveLength(2); // receipt1 + receipt2
      }
    });

    test('should handle empty enrichment data gracefully', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok([])),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok([])),
        getAccountReceipts: vi.fn().mockResolvedValue(ok([])),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);
        const typedNormalized = result.value.rawTransactions[0]?.normalizedData as NearTransaction;
        expect(typedNormalized.accountChanges).toBeUndefined();
        expect(typedNormalized.tokenTransfers).toBeUndefined();
      }
    });
  });

  describe('Transaction Enrichment', () => {
    test('should enrich transaction with account changes', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok(mockActivities)),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok([])),
        getAccountReceipts: vi.fn().mockResolvedValue(ok(mockReceipts)),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const enrichedTx = result.value.rawTransactions[0];
        const typedNormalized = enrichedTx?.normalizedData as NearTransaction;
        expect(typedNormalized.accountChanges).toBeDefined();
        expect(typedNormalized.accountChanges).toHaveLength(1);
        expect(typedNormalized.accountChanges![0]?.account).toBe(address);
      }
    });

    test('should enrich transaction with token transfers', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok([])),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok(mockFtTransactions)),
        getAccountReceipts: vi.fn().mockResolvedValue(ok(mockReceipts)),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const enrichedTx = result.value.rawTransactions[0];
        const typedNormalized = enrichedTx?.normalizedData as NearTransaction;
        expect(typedNormalized.tokenTransfers).toBeDefined();
        expect(typedNormalized.tokenTransfers).toHaveLength(1);
        expect(typedNormalized.tokenTransfers![0]?.symbol).toBe('USDC');
      }
    });

    test('should enrich transaction with both account changes and token transfers', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok(mockActivities)),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok(mockFtTransactions)),
        getAccountReceipts: vi.fn().mockResolvedValue(ok(mockReceipts)),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const enrichedTx = result.value.rawTransactions[0];
        const typedNormalized = enrichedTx?.normalizedData as NearTransaction;
        expect(typedNormalized.accountChanges).toBeDefined();
        expect(typedNormalized.accountChanges).toHaveLength(1);
        expect(typedNormalized.tokenTransfers).toBeDefined();
        expect(typedNormalized.tokenTransfers).toHaveLength(1);
      }
    });

    test('should not enrich transaction without matching receipts', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const nonMatchingReceipts: NearBlocksReceipt[] = [
        {
          originated_from_transaction_hash: 'tx999',
          predecessor_account_id: 'alice.near',
          receipt_id: 'receipt999',
          receiver_account_id: 'bob.near',
        },
      ];

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok(mockActivities)),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok([])),
        getAccountReceipts: vi.fn().mockResolvedValue(ok(nonMatchingReceipts)),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const enrichedTx = result.value.rawTransactions[0];
        const typedNormalized = enrichedTx?.normalizedData as NearTransaction;
        expect(typedNormalized.accountChanges).toBeUndefined();
      }
    });
  });

  describe('Degraded Mode (Enrichment Failures)', () => {
    test('should continue in degraded mode when enrichment fetch fails', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(err(new Error('Activities API down'))),
        getAccountFtTransactions: vi.fn().mockResolvedValue(err(new Error('FT API down'))),
        getAccountReceipts: vi.fn().mockResolvedValue(err(new Error('Receipts API down'))),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);
        const typedNormalized = result.value.rawTransactions[0]?.normalizedData as NearTransaction;
        expect(typedNormalized.accountChanges).toBeUndefined();
        expect(typedNormalized.tokenTransfers).toBeUndefined();
      }
    });

    test('should continue when only receipts fail', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok(mockActivities)),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok(mockFtTransactions)),
        getAccountReceipts: vi.fn().mockResolvedValue(err(new Error('Receipts API down'))),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.rawTransactions).toHaveLength(1);
      }
    });

    test('should fail when base transaction fetch fails', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      mockProviderManager.getProviders.mockReturnValue([
        {
          name: 'nearblocks',
        } as never,
      ]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        err(
          new ProviderError('All providers failed', 'ALL_PROVIDERS_FAILED', {
            blockchain: 'near',
          })
        )
      );

      const result = await importer.import({ address });

      expect(result.isErr()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid activity data gracefully', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const invalidActivities: NearBlocksActivity[] = [
        {
          absolute_nonstaked_amount: '',
          block_timestamp: '1640000000000000000',
          direction: 'INBOUND',
          receipt_id: 'receipt123',
        },
      ];

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok(invalidActivities)),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok([])),
        getAccountReceipts: vi.fn().mockResolvedValue(ok(mockReceipts)),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const typedNormalized = result.value.rawTransactions[0]?.normalizedData as NearTransaction;
        expect(typedNormalized.accountChanges).toBeUndefined();
      }
    });

    test('should handle invalid FT transaction data gracefully', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      const invalidFtTxs: NearBlocksFtTransaction[] = [
        {
          affected_account_id: '',
          block_timestamp: '1640000000000000000',
          receipt_id: 'receipt123',
        },
      ];

      const mockProvider = {
        getAccountActivities: vi.fn().mockResolvedValue(ok([])),
        getAccountFtTransactions: vi.fn().mockResolvedValue(ok(invalidFtTxs)),
        getAccountReceipts: vi.fn().mockResolvedValue(ok(mockReceipts)),
        name: 'nearblocks',
      };

      mockProviderManager.getProviders.mockReturnValue([mockProvider] as never[]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'nearblocks',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const typedNormalized = result.value.rawTransactions[0]?.normalizedData as NearTransaction;
        expect(typedNormalized.tokenTransfers).toBeUndefined();
      }
    });

    test('should handle provider not found error', async () => {
      const importer = createImporter();
      const address = 'alice.near';

      mockProviderManager.getProviders.mockReturnValue([]);

      mockProviderManager.executeWithFailover.mockResolvedValueOnce(
        ok({
          data: [{ normalized: mockBaseTx, raw: { transaction_hash: 'tx123' } }],
          providerName: 'unknown-provider',
        } as FailoverExecutionResult<unknown>)
      );

      const result = await importer.import({ address });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const typedNormalized = result.value.rawTransactions[0]?.normalizedData as NearTransaction;
        expect(typedNormalized.accountChanges).toBeUndefined();
      }
    });
  });
});
