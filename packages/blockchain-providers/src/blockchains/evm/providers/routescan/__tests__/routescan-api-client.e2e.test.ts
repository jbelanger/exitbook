import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { RawBalanceData, TransactionWithRawData } from '../../../../../core/types/index.js';
import type { EvmTransaction } from '../../../types.js';
import { RoutescanApiClient } from '../routescan.api-client.js';

describe('RoutescanApiClient Integration - Ethereum', () => {
  const config = ProviderRegistry.createDefaultConfig('ethereum', 'routescan');
  const provider = new RoutescanApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7';

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
        expect(balance.symbol).toBe('ETH');
        expect(balance.decimals).toBe(18);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
        if (balance.decimalAmount) {
          expect(parseFloat(balance.decimalAmount)).toBeGreaterThanOrEqual(0);
        }
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
          expect(firstTx.normalized.currency).toBe('ETH');
          expect(firstTx.normalized.providerName).toBe('routescan');
        }
      }
    }, 60000);

    it('should fetch raw address internal transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
        transactionType: 'internal',
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
          expect(firstTx.normalized.providerName).toBe('routescan');
        }
      }
    }, 60000);
  });

  describe('Token Transactions', () => {
    it('should fetch token transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
        transactionType: 'token',
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
          expect(firstTx.normalized.providerName).toBe('routescan');
        }
      }
    }, 60000);
  });
});

describe('RoutescanApiClient Integration - Optimism', () => {
  const config = ProviderRegistry.createDefaultConfig('optimism', 'routescan');
  const provider = new RoutescanApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7'; // Low activity address

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
        expect(balance.symbol).toBe('ETH');
        expect(balance.decimals).toBe(18);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
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
          expect(firstTx.normalized.currency).toBe('ETH');
          expect(firstTx.normalized.providerName).toBe('routescan');
        }
      }
    }, 60000);
  });
});

describe('RoutescanApiClient Integration - BSC', () => {
  const config = ProviderRegistry.createDefaultConfig('bsc', 'routescan');
  const provider = new RoutescanApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7'; // Low activity address

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
        expect(balance.symbol).toBe('BNB');
        expect(balance.decimals).toBe(18);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
        if (balance.decimalAmount) {
          expect(parseFloat(balance.decimalAmount)).toBeGreaterThanOrEqual(0);
        }
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
          expect(firstTx.normalized.currency).toBe('BNB');
          expect(firstTx.normalized.providerName).toBe('routescan');
        }
      }
    }, 60000);
  });
});

describe('RoutescanApiClient Integration - Mantle', () => {
  const config = ProviderRegistry.createDefaultConfig('mantle', 'routescan');
  const provider = new RoutescanApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7'; // Low activity address

  describe('Health Checks', () => {
    it.skip('should report healthy when API is accessible', async () => {
      // Skipping: Mantle API endpoint may not be available or configured correctly
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it.skip('should fetch address balance successfully', async () => {
      // Skipping: Mantle API endpoint may not be available or configured correctly
      const result = await provider.execute<RawBalanceData>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance.symbol).toBe('MNT');
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
      }
    }, 30000);
  });
});
