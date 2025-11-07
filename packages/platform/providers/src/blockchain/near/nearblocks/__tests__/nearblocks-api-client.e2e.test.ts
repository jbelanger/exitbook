import { beforeAll, describe, expect, it } from 'vitest';

import type { RawBalanceData, TransactionWithRawData } from '../../../../shared/blockchain/index.js';
import { ProviderRegistry } from '../../../../shared/blockchain/index.js';
import type { NearTransaction } from '../../types.js';
import { NearBlocksApiClient } from '../nearblocks.api-client.js';
import type {
  NearBlocksActivity,
  NearBlocksFtTransaction,
  NearBlocksReceipt,
  NearBlocksTransaction,
} from '../nearblocks.schemas.js';

describe.sequential('NearBlocksApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks');
  const client = new NearBlocksApiClient(config);
  const testAddress = '3c49dfe359205e7ceb0cfac58f3592d12b14554e73f1f5448ea938cb04cf5fcc'; // 'b9c69753f8c5367eb42e1d958804298f7f3d4e0dddb780b396a2bf57bd595f1e'; // Address with token txs and receipts
  const emptyAddress = 'nonexistent12345.near'; // Unlikely to exist

  // Cache fetched data to reuse across tests
  let cachedTransactions: TransactionWithRawData<NearTransaction>[] = [];
  let cachedReceipts: NearBlocksReceipt[] = [];
  let cachedActivities: NearBlocksActivity[] = [];
  let cachedFtTransactions: NearBlocksFtTransaction[] = [];

  // Fetch data once before all tests
  beforeAll(async () => {
    // Fetch transactions
    const txResult = await client.execute<TransactionWithRawData<NearTransaction>[]>({
      address: testAddress,
      type: 'getAddressTransactions',
    });
    if (txResult.isOk()) {
      cachedTransactions = txResult.value;
    } else throw new Error(`Failed to fetch transactions for setup: ${txResult.error.message}`);

    // Fetch receipts
    const receiptsResult = await client.getAccountReceipts(testAddress);
    if (receiptsResult.isOk()) {
      cachedReceipts = receiptsResult.value;
    } else throw new Error(`Failed to fetch receipts for setup: ${receiptsResult.error.message}`);

    // Fetch activities
    const activitiesResult = await client.getAccountActivities(testAddress);
    if (activitiesResult.isOk()) {
      cachedActivities = activitiesResult.value;
    } else throw new Error(`Failed to fetch activities for setup: ${activitiesResult.error.message}`);

    // Fetch FT transactions
    const ftResult = await client.getAccountFtTransactions(testAddress);
    if (ftResult.isOk()) {
      cachedFtTransactions = ftResult.value;
    } else throw new Error(`Failed to fetch FT transactions for setup: ${ftResult.error.message}`);
  }, 90000);

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await client.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Transactions with Normalization', () => {
    it('should fetch and normalize transactions successfully', () => {
      expect(Array.isArray(cachedTransactions)).toBe(true);
      expect(cachedTransactions.length).toBeGreaterThan(0);

      if (cachedTransactions.length > 0) {
        const txData = cachedTransactions[0]!;

        expect(txData).toHaveProperty('raw');
        expect(txData).toHaveProperty('normalized');

        const raw = txData.raw as NearBlocksTransaction;
        expect(raw).toHaveProperty('transaction_hash');
        expect(raw).toHaveProperty('predecessor_account_id');
        expect(raw).toHaveProperty('receiver_account_id');
        expect(raw).toHaveProperty('block_timestamp');
        expect(raw).toHaveProperty('actions');

        const normalized = txData.normalized;
        expect(normalized.providerName).toBe('nearblocks');
        expect(typeof normalized.id).toBe('string');
        expect(normalized.id.length).toBeGreaterThan(0);
        expect(['success', 'failed', 'pending']).toContain(normalized.status);
        expect(typeof normalized.amount).toBe('string');
        expect(normalized.currency).toBe('NEAR');
        expect(normalized.timestamp).toBeGreaterThan(0);

        expect(normalized.id).toBe(raw.transaction_hash);
        expect(normalized.from).toBe(raw.predecessor_account_id);
        expect(normalized.to).toBe(raw.receiver_account_id);
      }
    });

    it('should include account balance changes in normalized transactions', () => {
      const txWithBalanceChanges = cachedTransactions.find(
        (tx) => tx.normalized.accountChanges && tx.normalized.accountChanges.length > 0
      );

      if (!txWithBalanceChanges) {
        console.warn('No transactions with balance changes found, skipping test');
        return;
      }

      const normalized = txWithBalanceChanges.normalized;
      expect(Array.isArray(normalized.accountChanges)).toBe(true);
      expect(normalized.accountChanges!.length).toBeGreaterThan(0);

      const change = normalized.accountChanges![0]!;
      expect(typeof change.account).toBe('string');
      expect(typeof change.preBalance).toBe('string');
      expect(typeof change.postBalance).toBe('string');
    });

    it('should include token transfers when present', () => {
      const transactions = cachedTransactions;
      const txWithTokenTransfers = transactions.find(
        (tx) => tx.normalized.tokenTransfers && tx.normalized.tokenTransfers.length > 0
      );

      if (!txWithTokenTransfers) {
        console.warn('No transactions with token transfers found, skipping test');
        return;
      }

      const normalized = txWithTokenTransfers.normalized;
      expect(Array.isArray(normalized.tokenTransfers)).toBe(true);
      expect(normalized.tokenTransfers!.length).toBeGreaterThan(0);

      const tokenTransfer = normalized.tokenTransfers![0]!;
      expect(typeof tokenTransfer.contractAddress).toBe('string');
      expect(typeof tokenTransfer.from).toBe('string');
      expect(typeof tokenTransfer.to).toBe('string');
      expect(typeof tokenTransfer.amount).toBe('string');
    });

    it('should convert fees from gas burnt to NEAR', () => {
      const transactions = cachedTransactions;
      if (transactions.length > 0) {
        const txData = transactions[0]!;
        const normalized = txData.normalized;

        if (normalized.feeAmount && normalized.feeCurrency) {
          expect(normalized.feeCurrency).toBe('NEAR');
          expect(typeof normalized.feeAmount).toBe('string');
          const feeNum = parseFloat(normalized.feeAmount);
          expect(feeNum).toBeGreaterThan(0);
        }
      }
    });

    it('should include action types in normalized transactions', () => {
      const transactions = cachedTransactions;
      if (transactions.length > 0) {
        const txData = transactions[0]!;
        const normalized = txData.normalized;

        expect(Array.isArray(normalized.actions)).toBe(true);
        if (normalized.actions && normalized.actions.length > 0) {
          const action = normalized.actions[0]!;
          expect(typeof action.actionType).toBe('string');
          expect(action.actionType.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Address Balance', () => {
    it('should fetch address balance in normalized format', async () => {
      const result = await client.execute<RawBalanceData>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('NEAR');
      expect(balance.decimals).toBe(24);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();

      if (balance.decimalAmount) {
        const numericBalance = Number(balance.decimalAmount);
        expect(numericBalance).not.toBeNaN();
        expect(numericBalance).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle invalid addresses gracefully', async () => {
      const invalidAddress = 'invalid!@#$%';

      const result = await client.execute<TransactionWithRawData<NearTransaction>[]>({
        address: invalidAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid NEAR account ID');
      }
    });

    it('should handle unsupported operations gracefully', async () => {
      const result = await client.execute<unknown>({
        address: testAddress,
        type: 'non-existent' as never,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Unsupported operation: non-existent');
      }
    });

    it('should handle empty transaction history gracefully', async () => {
      const result = await client.execute<TransactionWithRawData<NearTransaction>[]>({
        address: emptyAddress,
        type: 'getAddressTransactions',
      });

      // Should either succeed with empty array or fail gracefully
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
      } else {
        // API might return error for non-existent account
        expect(result.isErr()).toBe(true);
      }
    }, 30000);
  });

  describe('Enrichment Endpoints', () => {
    describe('getAccountReceipts', () => {
      it('should fetch account receipts successfully', () => {
        expect(Array.isArray(cachedReceipts)).toBe(true);
        expect(cachedReceipts.length).toBeGreaterThan(0);

        if (cachedReceipts.length > 0) {
          const receipt = cachedReceipts[0]!;
          expect(receipt).toHaveProperty('receipt_id');
          expect(receipt).toHaveProperty('originated_from_transaction_hash');
          expect(receipt).toHaveProperty('predecessor_account_id');
          expect(receipt).toHaveProperty('receiver_account_id');
          expect(typeof receipt.receipt_id).toBe('string');
          expect(receipt.receipt_id.length).toBeGreaterThan(0);
        }
      });

      it('should support pagination for receipts', async () => {
        const page1Result = await client.getAccountReceipts(testAddress, 1, 10);
        expect(page1Result.isOk()).toBe(true);
        if (page1Result.isErr()) return;

        const page1Receipts = page1Result.value;
        expect(Array.isArray(page1Receipts)).toBe(true);

        // Try fetching page 2
        const page2Result = await client.getAccountReceipts(testAddress, 2, 10);
        expect(page2Result.isOk()).toBe(true);
        if (page2Result.isErr()) return;

        const page2Receipts = page2Result.value;
        expect(Array.isArray(page2Receipts)).toBe(true);

        // Pages should have different receipts (if both non-empty)
        if (page1Receipts.length > 0 && page2Receipts.length > 0) {
          expect(page1Receipts[0]!.receipt_id).not.toBe(page2Receipts[0]!.receipt_id);
        }
      }, 30000);

      it('should handle invalid address for receipts', async () => {
        const result = await client.getAccountReceipts('invalid!@#$%');
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid NEAR account ID');
        }
      });
    });

    describe('getAccountActivities', () => {
      it('should fetch account activities successfully', () => {
        expect(Array.isArray(cachedActivities)).toBe(true);
        expect(cachedActivities.length).toBeGreaterThan(0);

        if (cachedActivities.length > 0) {
          const activity = cachedActivities[0]!;
          expect(activity).toHaveProperty('transaction_hash');
          expect(activity).toHaveProperty('receipt_id');
          expect(activity).toHaveProperty('direction');
          expect(activity).toHaveProperty('absolute_nonstaked_amount');
          expect(['INBOUND', 'OUTBOUND']).toContain(activity.direction);
          expect(typeof activity.absolute_nonstaked_amount).toBe('string');
          expect(activity.absolute_nonstaked_amount.length).toBeGreaterThan(0);
        }
      });

      it('should support pagination for activities', async () => {
        const page1Result = await client.getAccountActivities(testAddress, 1, 10);
        expect(page1Result.isOk()).toBe(true);
        if (page1Result.isErr()) return;

        const page1Activities = page1Result.value;
        expect(Array.isArray(page1Activities)).toBe(true);

        // Try fetching page 2
        const page2Result = await client.getAccountActivities(testAddress, 2, 10);
        expect(page2Result.isOk()).toBe(true);
        if (page2Result.isErr()) return;

        const page2Activities = page2Result.value;
        expect(Array.isArray(page2Activities)).toBe(true);
      }, 30000);

      it('should validate activity direction enum', () => {
        const activities = cachedActivities;
        expect(activities.length).toBeGreaterThan(0);

        if (activities.length > 0) {
          activities.forEach((activity) => {
            expect(['INBOUND', 'OUTBOUND']).toContain(activity.direction);
          });
        }
      });

      it('should handle invalid address for activities', async () => {
        const result = await client.getAccountActivities('invalid!@#$%');
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid NEAR account ID');
        }
      });
    });

    describe('getAccountFtTransactions', () => {
      it('should fetch account FT transactions successfully', () => {
        expect(Array.isArray(cachedFtTransactions)).toBe(true);
        expect(cachedFtTransactions.length).toBeGreaterThan(0);

        if (cachedFtTransactions.length > 0) {
          const ftTx = cachedFtTransactions[0]!;
          expect(ftTx).toHaveProperty('transaction_hash');
          expect(ftTx).toHaveProperty('affected_account_id');
          expect(ftTx).toHaveProperty('involved_account_id');
          expect(ftTx).toHaveProperty('delta_amount');
          expect(ftTx).toHaveProperty('ft');
          expect(typeof ftTx.transaction_hash).toBe('string');
          expect(typeof ftTx.ft?.contract).toBe('string');
          expect(typeof ftTx.ft?.decimals).toBe('number');
        }
      });

      it('should support pagination for FT transactions', async () => {
        const page1Result = await client.getAccountFtTransactions(testAddress, 1, 10);
        expect(page1Result.isOk()).toBe(true);
        if (page1Result.isErr()) return;

        const page1FtTxs = page1Result.value;
        expect(Array.isArray(page1FtTxs)).toBe(true);

        // Try fetching page 2
        const page2Result = await client.getAccountFtTransactions(testAddress, 2, 10);
        expect(page2Result.isOk()).toBe(true);
        if (page2Result.isErr()) return;

        const page2FtTxs = page2Result.value;
        expect(Array.isArray(page2FtTxs)).toBe(true);
      }, 30000);

      it('should validate FT transaction structure', () => {
        const ftTransactions = cachedFtTransactions;
        expect(ftTransactions.length).toBeGreaterThan(0);

        if (ftTransactions.length > 0) {
          ftTransactions.forEach((ftTx) => {
            expect(ftTx.ft?.decimals).toBeGreaterThanOrEqual(0);
            expect(ftTx.ft?.decimals).toBeLessThanOrEqual(24);
          });
        }
      });

      it('should handle invalid address for FT transactions', async () => {
        const result = await client.getAccountFtTransactions('invalid!@#$%');
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid NEAR account ID');
        }
      });
    });

    describe('Enrichment Data Correlation', () => {
      it('should be able to correlate receipts, activities, and transactions', () => {
        const transactions = cachedTransactions;
        const receipts = cachedReceipts;

        expect(transactions.length).toBeGreaterThan(0);
        expect(receipts.length).toBeGreaterThan(0);

        // Verify we can find matching transaction hashes
        const txHashes = transactions.map((tx) => tx.normalized.id);
        const receiptTxHashes = receipts.map((r) => r.originated_from_transaction_hash);

        const hasMatchingHashes = txHashes.some((hash) => receiptTxHashes.includes(hash));
        expect(hasMatchingHashes).toBe(true);
      });

      it('should be able to correlate activities with transactions', () => {
        const transactions = cachedTransactions;
        const activities = cachedActivities;

        expect(transactions.length).toBeGreaterThan(0);
        expect(activities.length).toBeGreaterThan(0);

        // Verify we can find matching transaction hashes
        const txHashes = transactions.map((tx) => tx.normalized.id);
        const activityTxHashes = activities.map((a) => a.transaction_hash);

        const hasMatchingHashes = txHashes.some((hash) => activityTxHashes.includes(hash));
        expect(hasMatchingHashes).toBe(true);
      });
    });
  });

  describe('Configuration', () => {
    it('should support NEAR chain with correct configuration', () => {
      const nearConfig = ProviderRegistry.createDefaultConfig('near', 'nearblocks');
      const nearProvider = new NearBlocksApiClient(nearConfig);

      expect(nearProvider).toBeDefined();
      expect(nearProvider.blockchain).toBe('near');
    });

    it('should initialize with correct configuration', () => {
      const nearBlocksProvider = new NearBlocksApiClient(config);

      expect(nearBlocksProvider).toBeDefined();
      expect(nearBlocksProvider.blockchain).toBe('near');
    });
  });
});
