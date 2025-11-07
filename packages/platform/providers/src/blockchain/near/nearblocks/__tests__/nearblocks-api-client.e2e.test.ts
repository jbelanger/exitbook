import { describe, expect, it } from 'vitest';

import type { RawBalanceData, TransactionWithRawData } from '../../../../shared/blockchain/index.js';
import { ProviderRegistry } from '../../../../shared/blockchain/index.js';
import type { NearTransaction } from '../../types.js';
import { NearBlocksApiClient } from '../nearblocks.api-client.js';
import type { NearBlocksTransaction } from '../nearblocks.schemas.js';

describe('NearBlocksApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks');
  const client = new NearBlocksApiClient(config);
  const testAddress = 'foundation.near'; // Well-known NEAR Foundation account
  const emptyAddress = 'nonexistent12345.near'; // Unlikely to exist

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
    it('should fetch and normalize transactions successfully', async () => {
      const result = await client.execute<TransactionWithRawData<NearTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      if (result.isErr()) {
        console.error('Transaction fetch error:', result.error.message);
        console.error('Full error:', result.error);
      }
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        const txData = transactions[0]!;

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
    }, 60000);

    it('should include account balance changes in normalized transactions', async () => {
      const result = await client.execute<TransactionWithRawData<NearTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      const txWithBalanceChanges = transactions.find(
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
    }, 30000);

    it('should include token transfers when present', async () => {
      const result = await client.execute<TransactionWithRawData<NearTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
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
    }, 30000);

    it('should convert fees from gas burnt to NEAR', async () => {
      const result = await client.execute<TransactionWithRawData<NearTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
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
    }, 30000);

    it('should include action types in normalized transactions', async () => {
      const result = await client.execute<TransactionWithRawData<NearTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
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
    }, 30000);
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
      it('should fetch account receipts successfully', async () => {
        const result = await client.getAccountReceipts(testAddress);

        expect(result.isOk()).toBe(true);
        if (result.isErr()) {
          console.error('Receipts fetch error:', result.error.message);
          return;
        }

        const receipts = result.value;
        expect(Array.isArray(receipts)).toBe(true);

        if (receipts.length > 0) {
          const receipt = receipts[0]!;
          expect(receipt).toHaveProperty('receipt_id');
          expect(receipt).toHaveProperty('originated_from_transaction_hash');
          expect(receipt).toHaveProperty('predecessor_account_id');
          expect(receipt).toHaveProperty('receiver_account_id');
          expect(typeof receipt.receipt_id).toBe('string');
          expect(receipt.receipt_id.length).toBeGreaterThan(0);
        }
      }, 30000);

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
      it('should fetch account activities successfully', async () => {
        const result = await client.getAccountActivities(testAddress);

        expect(result.isOk()).toBe(true);
        if (result.isErr()) {
          console.error('Activities fetch error:', result.error.message);
          return;
        }

        const activities = result.value;
        expect(Array.isArray(activities)).toBe(true);

        if (activities.length > 0) {
          const activity = activities[0]!;
          expect(activity).toHaveProperty('transaction_hash');
          expect(activity).toHaveProperty('receipt_id');
          expect(activity).toHaveProperty('direction');
          expect(activity).toHaveProperty('absolute_nonstaked_amount');
          expect(['INBOUND', 'OUTBOUND']).toContain(activity.direction);
          expect(typeof activity.absolute_nonstaked_amount).toBe('string');
          expect(activity.absolute_nonstaked_amount.length).toBeGreaterThan(0);
        }
      }, 30000);

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

      it('should validate activity direction enum', async () => {
        const result = await client.getAccountActivities(testAddress);

        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;

        const activities = result.value;
        if (activities.length > 0) {
          activities.forEach((activity) => {
            expect(['INBOUND', 'OUTBOUND']).toContain(activity.direction);
          });
        }
      }, 30000);

      it('should handle invalid address for activities', async () => {
        const result = await client.getAccountActivities('invalid!@#$%');
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid NEAR account ID');
        }
      });
    });

    describe('getAccountFtTransactions', () => {
      it('should fetch account FT transactions successfully', async () => {
        const result = await client.getAccountFtTransactions(testAddress);

        expect(result.isOk()).toBe(true);
        if (result.isErr()) {
          console.error('FT transactions fetch error:', result.error.message);
          return;
        }

        const ftTransactions = result.value;
        expect(Array.isArray(ftTransactions)).toBe(true);

        if (ftTransactions.length > 0) {
          const ftTx = ftTransactions[0]!;
          expect(ftTx).toHaveProperty('transaction_hash');
          expect(ftTx).toHaveProperty('affected_account_id');
          expect(ftTx).toHaveProperty('involved_account_id');
          expect(ftTx).toHaveProperty('delta_amount');
          expect(ftTx).toHaveProperty('ft');
          expect(typeof ftTx.transaction_hash).toBe('string');
          expect(typeof ftTx.ft.contract).toBe('string');
          expect(typeof ftTx.ft.decimals).toBe('number');
        }
      }, 30000);

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

      it('should validate FT transaction structure', async () => {
        const result = await client.getAccountFtTransactions(testAddress);

        expect(result.isOk()).toBe(true);
        if (result.isErr()) return;

        const ftTransactions = result.value;
        if (ftTransactions.length > 0) {
          ftTransactions.forEach((ftTx) => {
            expect(ftTx.ft.decimals).toBeGreaterThanOrEqual(0);
            expect(ftTx.ft.decimals).toBeLessThanOrEqual(24);
          });
        }
      }, 30000);

      it('should handle invalid address for FT transactions', async () => {
        const result = await client.getAccountFtTransactions('invalid!@#$%');
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Invalid NEAR account ID');
        }
      });
    });

    describe('Enrichment Data Correlation', () => {
      it('should be able to correlate receipts, activities, and transactions', async () => {
        // Fetch transactions
        const txResult = await client.execute<TransactionWithRawData<NearTransaction>[]>({
          address: testAddress,
          type: 'getAddressTransactions',
        });
        expect(txResult.isOk()).toBe(true);
        if (txResult.isErr()) return;

        const transactions = txResult.value;
        if (transactions.length === 0) return;

        // Fetch receipts
        const receiptsResult = await client.getAccountReceipts(testAddress);
        expect(receiptsResult.isOk()).toBe(true);
        if (receiptsResult.isErr()) return;

        const receipts = receiptsResult.value;
        if (receipts.length === 0) return;

        // Verify we can find matching transaction hashes
        const txHashes = transactions.map((tx) => tx.normalized.id);
        const receiptTxHashes = receipts.map((r) => r.originated_from_transaction_hash);

        const hasMatchingHashes = txHashes.some((hash) => receiptTxHashes.includes(hash));
        expect(hasMatchingHashes).toBe(true);
      }, 60000);

      it('should be able to correlate activities with transactions', async () => {
        // Fetch transactions
        const txResult = await client.execute<TransactionWithRawData<NearTransaction>[]>({
          address: testAddress,
          type: 'getAddressTransactions',
        });
        expect(txResult.isOk()).toBe(true);
        if (txResult.isErr()) return;

        const transactions = txResult.value;
        if (transactions.length === 0) return;

        // Fetch activities
        const activitiesResult = await client.getAccountActivities(testAddress);
        expect(activitiesResult.isOk()).toBe(true);
        if (activitiesResult.isErr()) return;

        const activities = activitiesResult.value;
        if (activities.length === 0) return;

        // Verify we can find matching transaction hashes
        const txHashes = transactions.map((tx) => tx.normalized.id);
        const activityTxHashes = activities.map((a) => a.transaction_hash);

        const hasMatchingHashes = txHashes.some((hash) => activityTxHashes.includes(hash));
        expect(hasMatchingHashes).toBe(true);
      }, 60000);
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
