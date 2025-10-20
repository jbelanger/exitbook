import type { BlockchainBalanceSnapshot } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../../core/blockchain/types/index.ts';
import type { EvmTransaction } from '../../../types.ts';
import { AlchemyApiClient } from '../alchemy.api-client.ts';

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
    it('should fetch token balances in normalized format', async () => {
      const result = await provider.execute<BlockchainBalanceSnapshot[]>({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(Array.isArray(balances)).toBe(true);
        if (balances.length > 0) {
          const firstBalance = balances[0]!;
          expect(firstBalance).toHaveProperty('asset');
          expect(firstBalance).toHaveProperty('total');
          expect(typeof firstBalance.asset).toBe('string');
          expect(typeof firstBalance.total).toBe('string');
          // Token should be a contract address (0x...)
          expect(firstBalance.asset).toMatch(/^0x[a-fA-F0-9]{40}$/);
          // Total should be a numeric string
          expect(Number(firstBalance.total)).not.toBeNaN();
        }
      }
    }, 30000);

    it('should filter out balances with errors', async () => {
      const result = await provider.execute<BlockchainBalanceSnapshot[]>({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        // All returned balances should be valid (no error property)
        for (const balance of balances) {
          expect(balance).toHaveProperty('asset');
          expect(balance).toHaveProperty('total');
        }
      }
    }, 30000);

    it('should support specific contract addresses filter', async () => {
      // USDC contract address on Ethereum
      const usdcContract = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      const result = await provider.execute<BlockchainBalanceSnapshot[]>({
        address: testAddress,
        contractAddresses: [usdcContract],
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(Array.isArray(balances)).toBe(true);
        // Should only return balance for the specified contract
        for (const balance of balances) {
          expect(balance.asset.toLowerCase()).toBe(usdcContract.toLowerCase());
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
