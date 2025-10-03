import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { AddressInfo } from '../../types.ts';
import { MempoolSpaceApiClient } from '../mempool-space-api-client.ts';
import type { MempoolTransaction } from '../mempool-space.types.ts';

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
        type: 'getAddressInfo',
      });

      expect(result).toHaveProperty('txCount');
      expect(result).toHaveProperty('balance');
      expect(typeof result.txCount).toBe('number');
      expect(typeof result.balance).toBe('string');
    }, 30000);
  });

  describe('Raw Address Transactions', () => {
    it('should fetch raw address transactions successfully', async () => {
      const transactions = await provider.execute<MempoolTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('txid');
        expect(transactions[0]).toHaveProperty('vin');
        expect(transactions[0]).toHaveProperty('vout');
        expect(transactions[0]).toHaveProperty('status');
      }
    }, 30000);
  });
});
