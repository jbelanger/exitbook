import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../shared/index.ts';
import { SnowtraceApiClient } from '../snowtrace.api-client.ts';
import type { SnowtraceBalanceResponse } from '../snowtrace.types.ts';

describe('SnowtraceApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('avalanche', 'snowtrace');
  const provider = new SnowtraceApiClient(config);

  const testAddress = '0x70c68a08d8c1C1Fa1CD5E5533e85a77c4Ac07022';

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
      const result = await provider.execute<SnowtraceBalanceResponse>({
        address: testAddress,
        type: 'getRawAddressBalance',
      });

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('result');
      expect(result.status).toBe('1');
      expect(typeof result.result).toBe('string');
    }, 30000);
  });

  describe('Raw Address Transactions', () => {
    it('should fetch raw address transactions successfully', async () => {
      const transactions = await provider.execute<
        {
          blockNumber: string;
          from: string;
          hash: string;
          timeStamp: string;
          to: string;
          value: string;
        }[]
      >({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);

      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('from');
        expect(transactions[0]).toHaveProperty('to');
        expect(transactions[0]).toHaveProperty('value');
        expect(transactions[0]).toHaveProperty('timeStamp');
      }
    }, 30000);

    it('should fetch raw address internal transactions successfully', async () => {
      const transactions = await provider.execute<
        {
          blockNumber: string;
          from: string;
          hash: string;
          timeStamp: string;
          to: string;
          value: string;
        }[]
      >({
        address: testAddress,
        type: 'getRawAddressInternalTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);

      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('from');
        expect(transactions[0]).toHaveProperty('to');
        expect(transactions[0]).toHaveProperty('value');
        expect(transactions[0]).toHaveProperty('timeStamp');
      }
    }, 30000);
  });

  describe('Token Transactions', () => {
    it('should fetch token transactions successfully', async () => {
      const transactions = await provider.execute<
        {
          blockNumber: string;
          contractAddress: string;
          from: string;
          hash: string;
          timeStamp: string;
          to: string;
          tokenName: string;
          tokenSymbol: string;
          value: string;
        }[]
      >({
        address: testAddress,
        type: 'getTokenTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('from');
        expect(transactions[0]).toHaveProperty('to');
        expect(transactions[0]).toHaveProperty('value');
        expect(transactions[0]).toHaveProperty('timeStamp');
        expect(transactions[0]).toHaveProperty('tokenSymbol');
        expect(transactions[0]).toHaveProperty('tokenName');
        expect(transactions[0]).toHaveProperty('contractAddress');
      }
    }, 30000);
  });
});
