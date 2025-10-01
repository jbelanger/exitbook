import { describe, expect, it } from 'vitest';

import { AlchemyApiClient } from '../alchemy.api-client.ts';
import type { AlchemyAssetTransfer, AlchemyTokenBalance } from '../alchemy.types.ts';

describe('AlchemyApiClient Integration', () => {
  const provider = new AlchemyApiClient();
  const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // Vitalik's address

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
      const transactions = await provider.execute<AlchemyAssetTransfer[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('from');
        expect(transactions[0]).toHaveProperty('to');
        expect(transactions[0]).toHaveProperty('blockNum');
        expect(transactions[0]).toHaveProperty('category');
      }
    }, 30000);
  });

  describe('Token Transactions', () => {
    it('should fetch token transactions successfully', async () => {
      const transactions = await provider.execute<AlchemyAssetTransfer[]>({
        address: testAddress,
        type: 'getTokenTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('category');
        // Should be token-related category
        const category = transactions[0]!.category;
        expect(['erc1155', 'erc20', 'erc721', 'token'].includes(category)).toBe(true);
      }
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should fetch raw token balances successfully', async () => {
      const balances = await provider.execute<AlchemyTokenBalance[]>({
        address: testAddress,
        type: 'getRawTokenBalances',
      });

      expect(Array.isArray(balances)).toBe(true);
      if (balances.length > 0) {
        expect(balances[0]).toHaveProperty('contractAddress');
        expect(balances[0]).toHaveProperty('tokenBalance');
      }
    }, 30000);
  });
});
