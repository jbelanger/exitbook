import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../../core/blockchain/types/index.ts';
import type { EvmTransaction } from '../../../types.ts';
import { ThetaScanApiClient } from '../thetascan.api-client.ts';
import type { ThetaScanBalanceResponse, ThetaScanTokenBalance } from '../thetascan.types.ts';

describe('ThetaScanApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('theta', 'thetascan');
  const provider = new ThetaScanApiClient(config);
  // Example Theta address - you can replace with a known address
  const testAddress = '0x2E833968E5bB786Ae419c4d13189fB081Cc43bab';

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
        type: 'getRawAddressTransactions',
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
          expect(firstTx.normalized).toHaveProperty('timestamp');
          expect(firstTx.normalized.providerId).toBe('thetascan');
        }
      }
    }, 30000);

    it('should fetch transactions with since parameter', async () => {
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        since: oneYearAgo,
        type: 'getRawAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
        // All transactions should be after the since date
        if (transactions.length > 0) {
          transactions.forEach((tx) => {
            expect(tx.normalized.timestamp).toBeGreaterThanOrEqual(oneYearAgo);
          });
        }
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch raw address balance successfully', async () => {
      const result = await provider.execute<ThetaScanBalanceResponse>({
        address: testAddress,
        type: 'getRawAddressBalance',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        // Balance response should have theta, theta_staked, tfuel, and tfuel_staked
        expect(balance).toHaveProperty('theta');
        expect(balance).toHaveProperty('theta_staked');
        expect(balance).toHaveProperty('tfuel');
        expect(balance).toHaveProperty('tfuel_staked');
      }
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should return empty array when no contract addresses provided', async () => {
      const result = await provider.execute<ThetaScanTokenBalance[]>({
        address: testAddress,
        type: 'getRawTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(Array.isArray(balances)).toBe(true);
        expect(balances.length).toBe(0);
      }
    }, 30000);

    it('should handle token balances with contract addresses', async () => {
      // Example Theta token contract - replace with actual contract if known
      const contractAddresses = ['0x4dc08b15ea0e10b96c41aec22fab934ba15c983e'];

      const result = await provider.execute<ThetaScanTokenBalance[]>({
        address: testAddress,
        contractAddresses,
        type: 'getRawTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(Array.isArray(balances)).toBe(true);
        // May or may not have balances depending on the address
        if (balances.length > 0) {
          expect(balances[0]).toHaveProperty('address');
          expect(balances[0]).toHaveProperty('contract');
        }
      }
    }, 30000);
  });

  describe('Address Validation', () => {
    it('should reject invalid Theta addresses', async () => {
      const invalidAddress = 'invalid-address';

      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: invalidAddress,
        type: 'getRawAddressTransactions',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid Theta address');
      }
    });

    it('should accept valid Ethereum-style addresses', async () => {
      const validAddress = '0x0000000000000000000000000000000000000000';

      // Should not throw
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: validAddress,
        type: 'getRawAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
      }
    }, 30000);
  });
});
