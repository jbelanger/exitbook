import { describe, expect, it } from 'vitest';

import { createProviderRegistry } from '../../../../../initialize.js';
import { MempoolSpaceApiClient } from '../mempool-space-api-client.js';

const providerRegistry = createProviderRegistry();

describe('MempoolSpaceProvider Integration', () => {
  const config = providerRegistry.createDefaultConfig('bitcoin', 'mempool.space');
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
      const result = await provider.execute({
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

  describe('Has Address Transactions', () => {
    it('should return true for address with transactions', async () => {
      const result = await provider.execute({
        address: testAddress,
        type: 'hasAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);

    it('should return false for address without transactions', async () => {
      const result = await provider.execute({
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
