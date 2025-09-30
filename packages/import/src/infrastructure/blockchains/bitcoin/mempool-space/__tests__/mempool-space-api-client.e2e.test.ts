import { describe, expect, it } from 'vitest';

import type { AddressInfo } from '../../types.ts';
import { MempoolSpaceApiClient } from '../mempool-space-api-client.ts';
import type { MempoolTransaction } from '../mempool-space.types.ts';

describe('MempoolSpaceProvider Integration', () => {
  const provider = new MempoolSpaceApiClient();
  const testAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

  describe('Provider Configuration', () => {
    it('should initialize with correct registry metadata', () => {
      expect(provider.name).toBe('mempool.space');
      expect(provider.blockchain).toBe('bitcoin');
      expect(provider.capabilities.supportedOperations).toContain('getAddressTransactions');
      expect(provider.capabilities.supportedOperations).toContain('getAddressBalance');
    });

    it('should have correct rate limiting configuration', () => {
      expect(provider.rateLimit.requestsPerSecond).toBe(0.25);
      expect(provider.rateLimit.burstLimit).toBe(1);
    });

    it('should have correct capabilities', () => {
      const capabilities = provider.capabilities;
      expect(capabilities.maxBatchSize).toBe(25);
      expect(capabilities.supportsHistoricalData).toBe(true);
      expect(capabilities.supportsPagination).toBe(true);
      expect(capabilities.supportsRealTimeData).toBe(true);
      expect(capabilities.supportsTokenData).toBe(false);
    });
  });

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Transactions', () => {
    it('should fetch address transactions successfully', async () => {
      const transactions = await provider.execute<MempoolTransaction[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0 && transactions[0]) {
        expect(transactions[0]).toHaveProperty('id');
        expect(transactions[0]).toHaveProperty('timestamp');
        expect(transactions[0]).toHaveProperty('amount');
        expect(transactions[0]).toHaveProperty('currency', 'BTC');
        expect(['success', 'pending']).toContain(transactions[0].status);
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch address balance successfully', async () => {
      const result = await provider.execute<{ balance: string; token: string }>({
        address: testAddress,
        type: 'getAddressBalance',
      });

      expect(result).toHaveProperty('balance');
      expect(result).toHaveProperty('token', 'BTC');
      expect(typeof result.balance).toBe('string');
      expect(Number.isNaN(Number(result.balance))).toBe(false);
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
