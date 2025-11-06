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
        expect(raw).toHaveProperty('signer_id');
        expect(raw).toHaveProperty('receiver_id');
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
        expect(normalized.from).toBe(raw.signer_id);
        expect(normalized.to).toBe(raw.receiver_id);
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
      expect(typeof tokenTransfer.tokenContract).toBe('string');
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
        if (normalized.actions.length > 0) {
          const action = normalized.actions[0]!;
          expect(typeof action.action).toBe('string');
          expect(typeof action.from).toBe('string');
          expect(typeof action.to).toBe('string');
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
