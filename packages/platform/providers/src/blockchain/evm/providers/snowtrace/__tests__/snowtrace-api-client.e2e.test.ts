import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../../core/blockchain/types/index.ts';
import type { EvmTransaction } from '../../../types.ts';
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
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toHaveProperty('status');
        expect(balance).toHaveProperty('message');
        expect(balance).toHaveProperty('result');
        expect(balance.status).toBe('1');
        expect(typeof balance.result).toBe('string');
      }
    }, 30000);
  });

  describe('Raw Address Transactions', () => {
    it('should fetch raw address transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);

        if (transactions.length > 0) {
          const firstTx = transactions[0]!;
          expect(firstTx).toHaveProperty('raw');
          expect(firstTx).toHaveProperty('normalized');
          expect(firstTx.normalized).toHaveProperty('id');
          expect(firstTx.normalized).toHaveProperty('from');
          expect(firstTx.normalized).toHaveProperty('to');
          expect(firstTx.normalized.currency).toBe('AVAX');
          expect(firstTx.normalized.providerId).toBe('snowtrace');
        }
      }
    }, 30000);

    it('should fetch raw address internal transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressInternalTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);

        if (transactions.length > 0) {
          const firstTx = transactions[0]!;
          expect(firstTx).toHaveProperty('raw');
          expect(firstTx).toHaveProperty('normalized');
          expect(firstTx.normalized).toHaveProperty('id');
          expect(firstTx.normalized).toHaveProperty('from');
          expect(firstTx.normalized).toHaveProperty('to');
          expect(firstTx.normalized.providerId).toBe('snowtrace');
        }
      }
    }, 30000);
  });

  describe('Token Transactions', () => {
    it('should fetch token transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTokenTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const firstTx = transactions[0]!;
          expect(firstTx).toHaveProperty('raw');
          expect(firstTx).toHaveProperty('normalized');
          expect(firstTx.normalized).toHaveProperty('id');
          expect(firstTx.normalized.type).toBe('token_transfer');
          expect(firstTx.normalized.providerId).toBe('snowtrace');
        }
      }
    }, 30000);
  });
});
