import { describe, expect, it } from 'vitest';

import type { RawBalanceData, TransactionWithRawData } from '../../../../../core/index.ts';
import { ProviderRegistry } from '../../../../../core/index.ts';
import type { BitcoinTransaction } from '../../../schemas.ts';
import { MempoolSpaceApiClient } from '../mempool-space-api-client.js';

describe('MempoolSpaceProvider Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'mempool.space');
  const provider = new MempoolSpaceApiClient(config);
  const testAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
  const emptyAddress = 'bc1qeppvcnauqak9xn7mmekw4crr79tl9c8lnxpp2k'; // Address with no transactions

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch address balance successfully', async () => {
      const result = await provider.execute<RawBalanceData>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance.symbol).toBe('BTC');
        expect(balance.decimals).toBe(8);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
      }
    }, 30000);
  });

  describe('Normalized Address Transactions', () => {
    it('should fetch normalized address transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<BitcoinTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const txWithRaw = transactions[0]!;
          expect(txWithRaw).toHaveProperty('raw');
          expect(txWithRaw).toHaveProperty('normalized');

          expect(txWithRaw.raw).toHaveProperty('txid');
          expect(txWithRaw.raw).toHaveProperty('vin');
          expect(txWithRaw.raw).toHaveProperty('vout');

          const tx = txWithRaw.normalized;
          expect(tx).toHaveProperty('id');
          expect(tx).toHaveProperty('inputs');
          expect(tx).toHaveProperty('outputs');
          expect(tx).toHaveProperty('status');
          expect(tx).toHaveProperty('timestamp');
          expect(tx).toHaveProperty('currency');
          expect(tx).toHaveProperty('providerName');
          expect(tx.currency).toBe('BTC');
          expect(tx.providerName).toBe('mempool.space');
          expect(Array.isArray(tx.inputs)).toBe(true);
          expect(Array.isArray(tx.outputs)).toBe(true);
        }
      }
    }, 30000);
  });

  describe('Has Address Transactions', () => {
    it('should return true for address with transactions', async () => {
      const result = await provider.execute<boolean>({
        address: testAddress,
        type: 'hasAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);

    it('should return false for address without transactions', async () => {
      const result = await provider.execute<boolean>({
        address: emptyAddress,
        type: 'hasAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    }, 30000);
  });
});
