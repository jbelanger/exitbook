import { describe, expect, it } from 'vitest';

import type {
  MoralisNativeBalance,
  MoralisTokenBalance,
  MoralisTransaction,
} from '../../../shared/api/moralis-evm/moralis.types.ts';
import { MoralisApiClient } from '../moralis.api-client.ts';

describe('MoralisApiClient Integration', () => {
  const provider = new MoralisApiClient();
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

  describe('Raw Address Balance', () => {
    it('should fetch raw address balance successfully', async () => {
      const balance = await provider.execute<MoralisNativeBalance>({
        address: testAddress,
        type: 'getRawAddressBalance',
      });

      expect(balance).toHaveProperty('balance');
      expect(typeof balance.balance).toBe('string');
    }, 30000);
  });

  describe('Raw Address Transactions', () => {
    it('should fetch raw address transactions successfully', async () => {
      const transactions = await provider.execute<MoralisTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('from_address');
        expect(transactions[0]).toHaveProperty('to_address');
        expect(transactions[0]).toHaveProperty('block_number');
        expect(transactions[0]).toHaveProperty('block_timestamp');
      }
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should fetch raw token balances successfully', async () => {
      // Use a different address with fewer tokens to avoid Moralis's 2000 token limit
      const smallerAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4';

      const balances = await provider.execute<MoralisTokenBalance[]>({
        address: smallerAddress,
        type: 'getRawTokenBalances',
      });

      expect(Array.isArray(balances)).toBe(true);
      if (balances.length > 0) {
        expect(balances[0]).toHaveProperty('token_address');
        expect(balances[0]).toHaveProperty('balance');
        expect(balances[0]).toHaveProperty('symbol');
        expect(balances[0]).toHaveProperty('decimals');
      }
    }, 30000);
  });
});
