import { describe, expect, it } from 'vitest';

import type { TransactionWithRawData } from '../../../../core/blockchain/index.ts';
import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { AddressInfo, BitcoinTransaction } from '../../types.ts';
import { MempoolSpaceApiClient } from '../mempool-space-api-client.ts';

describe('MempoolSpaceProvider Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'mempool.space');
  const provider = new MempoolSpaceApiClient(config);
  const testAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Info', () => {
    it('should fetch address info successfully', async () => {
      const result = await provider.execute<AddressInfo>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const addressInfo = result.value;
        expect(addressInfo).toHaveProperty('txCount');
        expect(addressInfo).toHaveProperty('balance');
        expect(typeof addressInfo.txCount).toBe('number');
        expect(typeof addressInfo.balance).toBe('string');
      }
    }, 30000);
  });

  describe('Normalized Address Transactions', () => {
    it('should fetch normalized address transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<BitcoinTransaction>[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
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
          expect(tx).toHaveProperty('providerId');
          expect(tx.currency).toBe('BTC');
          expect(tx.providerId).toBe('mempool.space');
          expect(Array.isArray(tx.inputs)).toBe(true);
          expect(Array.isArray(tx.outputs)).toBe(true);
        }
      }
    }, 30000);
  });
});
