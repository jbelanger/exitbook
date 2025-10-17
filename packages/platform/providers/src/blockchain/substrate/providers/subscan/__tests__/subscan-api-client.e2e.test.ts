import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../../core/blockchain/types/index.ts';
import type { SubstrateTransaction } from '../../../types.ts';
import { SubscanApiClient } from '../subscan.api-client.ts';
import type { SubscanAccountResponse, SubscanTransferAugmented } from '../subscan.types.ts';

describe('SubscanApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('polkadot', 'subscan');
  const provider = new SubscanApiClient(config);
  // Test address with some activity but not too much (to avoid rate limiting)
  // This is a known address from Polkadot Wiki with limited transactions
  const testAddress = '1zugcavYA9yCuYwiEYeMHNJm9gXznYjNfXQjZsZukF1Mpow';

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Raw Address Balance', () => {
    it('should fetch raw address balance successfully', async () => {
      const result = await provider.execute<SubscanAccountResponse>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const response = result.value;
      expect(response).toHaveProperty('code');
      expect(response).toHaveProperty('data');
      expect(response.code).toBe(0);
      expect(response.data).toBeDefined();

      // Regular addresses should have balance/reserved fields
      if (response.data?.balance !== undefined || response.data?.reserved !== undefined) {
        expect(response.data).toHaveProperty('balance');
        expect(typeof response.data.balance).toBe('string');
      } else {
        // Special addresses (like treasury) may just have an account hex string
        expect(response.data).toHaveProperty('account');
        expect(typeof response.data?.account).toBe('string');
      }
    }, 30000);
  });

  describe('Raw Address Transactions', () => {
    it('should fetch raw address transactions successfully with normalization', async () => {
      const result = await provider.execute<TransactionWithRawData<SubstrateTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        const firstTx = transactions[0]!;

        expect(firstTx).toHaveProperty('raw');
        expect(firstTx).toHaveProperty('normalized');

        const rawData = firstTx.raw as SubscanTransferAugmented;

        expect(rawData).toHaveProperty('hash');
        expect(rawData).toHaveProperty('from');
        expect(rawData).toHaveProperty('to');
        expect(rawData).toHaveProperty('amount');
        expect(rawData).toHaveProperty('block_num');
        expect(rawData).toHaveProperty('block_timestamp');
        expect(rawData).toHaveProperty('success');
        expect(rawData).toHaveProperty('fee');

        expect(rawData).toHaveProperty('_nativeCurrency');
        expect(rawData).toHaveProperty('_nativeDecimals');
        expect(rawData).toHaveProperty('_chainDisplayName');
        expect(rawData._nativeCurrency).toBe('DOT');
        expect(typeof rawData._nativeDecimals).toBe('number');

        const normalized = firstTx.normalized;
        expect(normalized).toHaveProperty('id');
        expect(normalized).toHaveProperty('from');
        expect(normalized).toHaveProperty('to');
        expect(normalized).toHaveProperty('amount');
        expect(normalized).toHaveProperty('currency');
        expect(normalized).toHaveProperty('timestamp');
        expect(normalized).toHaveProperty('status');
        expect(normalized).toHaveProperty('providerId');
        expect(normalized).toHaveProperty('feeAmount');
        expect(normalized).toHaveProperty('feeCurrency');

        expect(normalized.currency).toBe('DOT');
        expect(normalized.feeCurrency).toBe('DOT');
        expect(normalized.providerId).toBe('subscan');
        expect(normalized.chainName).toBe('polkadot');
        expect(['success', 'failed']).toContain(normalized.status);
        expect(typeof normalized.amount).toBe('string');
        expect(typeof normalized.timestamp).toBe('number');
      }
    }, 30000);

    it.skip('should fetch transactions with since filter', async () => {
      // Use July 2023 timestamp - before the address's most recent tx (Aug 2023)
      // but after older transactions to test client-side filtering works
      const july2023 = new Date('2023-07-01').getTime();

      const result = await provider.execute<TransactionWithRawData<SubstrateTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
        since: july2023,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions.length).toBeGreaterThan(0);

      // All transactions should be after the since timestamp (client-side filtered)
      transactions.forEach((tx) => {
        expect(tx.normalized.timestamp).toBeGreaterThanOrEqual(july2023);
      });
    }, 30000);
  });
});
