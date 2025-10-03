import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import { ThetaScanApiClient } from '../thetascan.api-client.ts';
import type { ThetaScanTransaction, ThetaScanBalanceResponse, ThetaScanTokenBalance } from '../thetascan.types.ts';

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
      const transactions = await provider.execute<ThetaScanTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('sending_address');
        expect(transactions[0]).toHaveProperty('recieving_address');
        expect(transactions[0]).toHaveProperty('block');
        expect(transactions[0]).toHaveProperty('timestamp');
        expect(transactions[0]).toHaveProperty('theta');
        expect(transactions[0]).toHaveProperty('tfuel');
      }
    }, 30000);

    it('should fetch transactions with since parameter', async () => {
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const transactions = await provider.execute<ThetaScanTransaction[]>({
        address: testAddress,
        since: oneYearAgo,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      // All transactions should be after the since date
      if (transactions.length > 0) {
        transactions.forEach((tx) => {
          const txTimestamp = tx.timestamp * 1000; // Convert to milliseconds
          expect(txTimestamp).toBeGreaterThanOrEqual(oneYearAgo);
        });
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch raw address balance successfully', async () => {
      const balance = await provider.execute<ThetaScanBalanceResponse>({
        address: testAddress,
        type: 'getRawAddressBalance',
      });

      expect(balance).toBeDefined();
      // Balance response should have theta, theta_staked, tfuel, and tfuel_staked
      expect(balance).toHaveProperty('theta');
      expect(balance).toHaveProperty('theta_staked');
      expect(balance).toHaveProperty('tfuel');
      expect(balance).toHaveProperty('tfuel_staked');
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should return empty array when no contract addresses provided', async () => {
      const balances = await provider.execute<ThetaScanTokenBalance[]>({
        address: testAddress,
        type: 'getRawTokenBalances',
      });

      expect(Array.isArray(balances)).toBe(true);
      expect(balances.length).toBe(0);
    }, 30000);

    it('should handle token balances with contract addresses', async () => {
      // Example Theta token contract - replace with actual contract if known
      const contractAddresses = ['0x4dc08b15ea0e10b96c41aec22fab934ba15c983e'];

      const balances = await provider.execute<ThetaScanTokenBalance[]>({
        address: testAddress,
        contractAddresses,
        type: 'getRawTokenBalances',
      });

      expect(Array.isArray(balances)).toBe(true);
      // May or may not have balances depending on the address
      if (balances.length > 0) {
        expect(balances[0]).toHaveProperty('address');
        expect(balances[0]).toHaveProperty('contract');
      }
    }, 30000);
  });

  describe('Address Validation', () => {
    it('should reject invalid Theta addresses', async () => {
      const invalidAddress = 'invalid-address';

      await expect(
        provider.execute<ThetaScanTransaction[]>({
          address: invalidAddress,
          type: 'getRawAddressTransactions',
        })
      ).rejects.toThrow('Invalid Theta address');
    });

    it('should accept valid Ethereum-style addresses', async () => {
      const validAddress = '0x0000000000000000000000000000000000000000';

      // Should not throw
      const transactions = await provider.execute<ThetaScanTransaction[]>({
        address: validAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
    }, 30000);
  });
});
