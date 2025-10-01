import { describe, expect, it } from 'vitest';

import type {
  MoralisNativeBalance,
  MoralisTransaction,
  MoralisTokenBalance,
} from '../../../shared/api/moralis-evm/moralis.types.ts';
import { ProviderRegistry } from '../../../shared/index.ts';
import { MoralisApiClient } from '../moralis.api-client.ts';

describe('MoralisApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('avalanche', 'moralis');
  const provider = new MoralisApiClient(config);

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
      const balances = await provider.execute<MoralisTokenBalance[]>({
        address: testAddress,
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
