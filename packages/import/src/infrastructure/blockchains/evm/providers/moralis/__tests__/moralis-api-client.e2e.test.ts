import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../shared/index.ts';
import { MoralisApiClient } from '../moralis.api-client.ts';
import type { MoralisNativeBalance, MoralisTokenBalance, MoralisTransaction } from '../moralis.types.ts';

describe('MoralisApiClient Integration - Multi-Chain', () => {
  describe('Ethereum', () => {
    const config = ProviderRegistry.createDefaultConfig('ethereum', 'moralis');
    const provider = new MoralisApiClient(config);
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
      it('should fetch raw address transactions with augmented currency fields', async () => {
        const transactions = await provider.execute<MoralisTransaction[]>({
          address: testAddress,
          type: 'getRawAddressTransactions',
        });

        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const firstTx = transactions[0]!;
          expect(firstTx).toHaveProperty('hash');
          expect(firstTx).toHaveProperty('from_address');
          expect(firstTx).toHaveProperty('to_address');
          expect(firstTx).toHaveProperty('block_number');
          expect(firstTx).toHaveProperty('block_timestamp');
          // Verify augmented fields
          expect(firstTx._nativeCurrency).toBe('ETH');
          expect(firstTx._nativeDecimals).toBe(18);
        }
      }, 30000);
    });

    describe('Internal Transactions', () => {
      it('should fetch internal transactions with augmented currency fields', async () => {
        const transactions = await provider.execute<MoralisTransaction[]>({
          address: testAddress,
          type: 'getRawAddressInternalTransactions',
        });

        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const firstTx = transactions[0]!;
          // Verify augmented fields
          expect(firstTx._nativeCurrency).toBe('ETH');
          expect(firstTx._nativeDecimals).toBe(18);
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

  describe('Avalanche', () => {
    const config = ProviderRegistry.createDefaultConfig('avalanche', 'moralis');
    const provider = new MoralisApiClient(config);
    const testAddress = '0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9'; // Avalanche Foundation address

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
      it('should fetch raw address transactions with augmented currency fields', async () => {
        const transactions = await provider.execute<MoralisTransaction[]>({
          address: testAddress,
          type: 'getRawAddressTransactions',
        });

        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const firstTx = transactions[0]!;
          expect(firstTx).toHaveProperty('hash');
          // Verify augmented fields for Avalanche
          expect(firstTx._nativeCurrency).toBe('AVAX');
          expect(firstTx._nativeDecimals).toBe(18);
        }
      }, 30000);
    });

    describe('Internal Transactions', () => {
      it('should fetch internal transactions with augmented currency fields', async () => {
        const transactions = await provider.execute<MoralisTransaction[]>({
          address: testAddress,
          type: 'getRawAddressInternalTransactions',
        });

        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const firstTx = transactions[0]!;
          // Verify augmented fields for Avalanche
          expect(firstTx._nativeCurrency).toBe('AVAX');
          expect(firstTx._nativeDecimals).toBe(18);
        }
      }, 30000);
    });
  });
});
