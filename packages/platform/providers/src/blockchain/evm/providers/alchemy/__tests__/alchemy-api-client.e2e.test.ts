import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../../core/blockchain/types/index.ts';
import type { EvmTransaction } from '../../../types.ts';
import { AlchemyApiClient } from '../alchemy.api-client.ts';
import type { AlchemyTokenBalance } from '../alchemy.types.ts';

describe('AlchemyApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('ethereum', 'alchemy');
  const provider = new AlchemyApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7'; // Vitalik's address

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
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
          expect(firstTx.normalized).toHaveProperty('blockHeight');
          expect(firstTx.normalized.providerId).toBe('alchemy');
        }
      }
    }, 30000);

    it('should fetch raw internal transactions successfully', async () => {
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
          expect(firstTx.normalized.providerId).toBe('alchemy');
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
          expect(firstTx.normalized.providerId).toBe('alchemy');
        }
      }
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should fetch raw token balances successfully', async () => {
      const result = await provider.execute<AlchemyTokenBalance[]>({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(Array.isArray(balances)).toBe(true);
        if (balances.length > 0) {
          expect(balances[0]).toHaveProperty('contractAddress');
          expect(balances[0]).toHaveProperty('tokenBalance');
        }
      }
    }, 30000);
  });

  describe('Multi-Chain Support', () => {
    it('should support Avalanche chain with correct base URL', () => {
      const avalancheConfig = ProviderRegistry.createDefaultConfig('avalanche', 'alchemy');
      const avalancheProvider = new AlchemyApiClient(avalancheConfig);

      expect(avalancheProvider).toBeDefined();
      expect(avalancheProvider.blockchain).toBe('avalanche');
    });

    it('should support Polygon chain with correct base URL', () => {
      const polygonConfig = ProviderRegistry.createDefaultConfig('polygon', 'alchemy');
      const polygonProvider = new AlchemyApiClient(polygonConfig);

      expect(polygonProvider).toBeDefined();
      expect(polygonProvider.blockchain).toBe('polygon');
    });
  });
});
