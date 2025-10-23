import type { BlockchainBalanceSnapshot } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../shared/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../../shared/blockchain/types/index.ts';
import type { SubstrateTransaction } from '../../../types.ts';
import { SubscanApiClient } from '../subscan.api-client.ts';
import type { SubscanTransferAugmented } from '../subscan.schemas.js';

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
      const result = await provider.execute<BlockchainBalanceSnapshot>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const balance = result.value;
      expect(balance).toHaveProperty('total');
      expect(typeof balance.total).toBe('string');

      // Balance should be a valid decimal number string
      expect(() => parseFloat(balance.total)).not.toThrow();
      expect(parseFloat(balance.total)).toBeGreaterThanOrEqual(0);
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
  });
});
