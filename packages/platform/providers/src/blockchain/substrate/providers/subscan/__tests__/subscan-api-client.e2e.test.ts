import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
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
        type: 'getRawAddressBalance',
      });

      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('data');
      expect(result.code).toBe(0);
      expect(result.data).toBeDefined();

      // Regular addresses should have balance/reserved fields
      if (result.data?.balance !== undefined || result.data?.reserved !== undefined) {
        expect(result.data).toHaveProperty('balance');
        expect(typeof result.data.balance).toBe('string');
      } else {
        // Special addresses (like treasury) may just have an account hex string
        expect(result.data).toHaveProperty('account');
        expect(typeof result.data?.account).toBe('string');
      }
    }, 30000);
  });

  describe('Raw Address Transactions', () => {
    it('should fetch raw address transactions successfully', async () => {
      const transactions = await provider.execute<SubscanTransferAugmented[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        const firstTx = transactions[0];
        expect(firstTx).toHaveProperty('hash');
        expect(firstTx).toHaveProperty('from');
        expect(firstTx).toHaveProperty('to');
        expect(firstTx).toHaveProperty('amount');
        expect(firstTx).toHaveProperty('block_num');
        expect(firstTx).toHaveProperty('block_timestamp');
        expect(firstTx).toHaveProperty('success');
        expect(firstTx).toHaveProperty('fee');

        // Check augmented fields
        expect(firstTx).toHaveProperty('_nativeCurrency');
        expect(firstTx).toHaveProperty('_nativeDecimals');
        expect(firstTx).toHaveProperty('_chainDisplayName');
        expect(firstTx?._nativeCurrency).toBe('DOT');
        expect(typeof firstTx?._nativeDecimals).toBe('number');
      }
    }, 30000);

    it('should fetch transactions with since filter', async () => {
      // Use July 2023 timestamp - before the address's most recent tx (Aug 2023)
      // but after older transactions to test client-side filtering works
      const july2023 = new Date('2023-07-01').getTime();

      const transactions = await provider.execute<SubscanTransferAugmented[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
        since: july2023,
      });

      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions.length).toBeGreaterThan(0);

      // All transactions should be after the since timestamp (client-side filtered)
      transactions.forEach((tx) => {
        expect(tx.block_timestamp * 1000).toBeGreaterThanOrEqual(july2023);
      });
    }, 30000);
  });
});
