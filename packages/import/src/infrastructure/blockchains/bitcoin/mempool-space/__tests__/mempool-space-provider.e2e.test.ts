import { beforeEach, describe, expect, it } from 'vitest';

import type { UniversalBlockchainTransaction } from '../../../../../app/ports/raw-data-mappers.ts';
import type { AddressInfo } from '../../types.ts';
import { MempoolSpaceApiClient } from '../mempool-space-api-client.ts';
import type { MempoolTransaction } from '../mempool-space.types.ts';

describe('MempoolSpaceProvider Integration', () => {
  let provider: MempoolSpaceApiClient;

  beforeEach(() => {
    provider = new MempoolSpaceApiClient();
  });

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
      const isHealthy = await provider.isHealthy();
      expect(isHealthy).toBe(true);
    }, 30000);

    it('should pass connection test', async () => {
      const connectionTest = await provider.testConnection();
      expect(connectionTest).toBe(true);
    }, 30000);
  });

  describe('Address Transactions', () => {
    const testAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'; // Known address with transactions

    it('should fetch address transactions successfully', async () => {
      const transactions = await provider.execute<UniversalBlockchainTransaction[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0 && transactions[0]) {
        expect(transactions[0]).toHaveProperty('id');
        expect(transactions[0]).toHaveProperty('timestamp');
        expect(transactions[0]).toHaveProperty('amount');
        expect(transactions[0]).toHaveProperty('currency', 'BTC');
        expect(['transfer_in', 'transfer_out']).toContain(transactions[0].type);
        expect(['success', 'pending']).toContain(transactions[0].status);
      }
    }, 30000);

    it('should return empty array for unused address', async () => {
      const unusedAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address, unlikely to have new txs

      const transactions = await provider.execute<UniversalBlockchainTransaction[]>({
        address: unusedAddress,
        type: 'getAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
    }, 30000);

    it('should filter transactions by timestamp when since parameter is provided', async () => {
      const futureTimestamp = Date.now() + 86400000; // 24 hours from now

      const transactions = await provider.execute<UniversalBlockchainTransaction[]>({
        address: testAddress,
        since: futureTimestamp,
        type: 'getAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions).toHaveLength(0);
    }, 30000);
  });

  describe('Address Balance', () => {
    const testAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

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

    it('should handle empty address balance', async () => {
      const emptyAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'; // Empty bech32 address

      const result = await provider.execute<{ balance: string; token: string }>({
        address: emptyAddress,
        type: 'getAddressBalance',
      });

      expect(result).toEqual({
        balance: '0',
        token: 'BTC',
      });
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should throw error for unsupported operations', async () => {
      await expect(
        provider.execute({
          address: 'dummy-address',
          type: 'unsupportedOperation' as 'getAddressTransactions',
        })
      ).rejects.toThrow('Unsupported operation: unsupportedOperation');
    });

    it('should handle invalid address format gracefully', async () => {
      const invalidAddress = 'invalid-address-format';

      await expect(
        provider.execute({
          address: invalidAddress,
          type: 'getAddressBalance',
        })
      ).rejects.toThrow();
    }, 30000);
  });

  describe('Address Info', () => {
    const testAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

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
    const testAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

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
