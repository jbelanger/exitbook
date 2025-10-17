import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../../core/blockchain/types/index.ts';
import type { EvmTransaction } from '../../../types.ts';
import { MoralisApiClient } from '../moralis.api-client.ts';
import type { MoralisNativeBalance, MoralisTokenBalance } from '../moralis.types.ts';

describe('MoralisApiClient Integration - Multi-Chain', () => {
  describe('Ethereum', () => {
    const config = ProviderRegistry.createDefaultConfig('ethereum', 'moralis');
    const provider = new MoralisApiClient(config);
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

    describe('Raw Address Balance', () => {
      it('should fetch raw address balance successfully', async () => {
        const result = await provider.execute<MoralisNativeBalance>({
          address: testAddress,
          type: 'getRawAddressBalance',
        });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const balance = result.value;
          expect(balance).toHaveProperty('balance');
          expect(typeof balance.balance).toBe('string');
        }
      }, 30000);
    });

    describe('Raw Address Transactions', () => {
      it('should fetch raw address transactions with augmented currency fields', async () => {
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
            expect(firstTx.normalized.currency).toBe('ETH');
            expect(firstTx.normalized.providerId).toBe('moralis');
          }
        }
      }, 30000);
    });

    describe('Internal Transactions', () => {
      it('should return empty array for internal transactions (included in main transactions)', async () => {
        const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
          address: testAddress,
          type: 'getRawAddressInternalTransactions',
        });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const transactions = result.value;
          expect(Array.isArray(transactions)).toBe(true);
          // Moralis includes internal transactions in the main transaction call, so this should be empty
          expect(transactions).toHaveLength(0);
        }
      }, 30000);
    });

    describe('Token Balances', () => {
      it('should fetch raw token balances successfully', async () => {
        // Use a different address with fewer tokens to avoid Moralis's 2000 token limit
        const smallerAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4';

        const result = await provider.execute<MoralisTokenBalance[]>({
          address: smallerAddress,
          type: 'getRawTokenBalances',
        });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const balances = result.value;
          expect(Array.isArray(balances)).toBe(true);
          if (balances.length > 0) {
            expect(balances[0]).toHaveProperty('token_address');
            expect(balances[0]).toHaveProperty('balance');
            expect(balances[0]).toHaveProperty('symbol');
            expect(balances[0]).toHaveProperty('decimals');
          }
        }
      }, 30000);
    });
  });

  describe('Avalanche', () => {
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

    describe('Raw Address Transactions', () => {
      it('should fetch raw address transactions with augmented currency fields', async () => {
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
            expect(firstTx.normalized.currency).toBe('AVAX');
            expect(firstTx.normalized.providerId).toBe('moralis');
          }
        }
      }, 30000);
    });

    describe('Internal Transactions', () => {
      it('should return empty array for internal transactions (included in main transactions)', async () => {
        const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
          address: testAddress,
          type: 'getRawAddressInternalTransactions',
        });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const transactions = result.value;
          expect(Array.isArray(transactions)).toBe(true);
          // Moralis includes internal transactions in the main transaction call, so this should be empty
          expect(transactions).toHaveLength(0);
        }
      }, 30000);
    });
  });
});
