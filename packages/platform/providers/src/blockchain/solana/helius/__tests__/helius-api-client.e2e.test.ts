import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import { HeliusApiClient } from '../helius.api-client.ts';
import type { HeliusTransaction } from '../helius.types.ts';

describe('HeliusApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('solana', 'helius');
  const provider = new HeliusApiClient(config);
  const testAddress = 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm'; // A known Solana address

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
      const result = await provider.execute<HeliusTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0 && transactions[0]) {
        expect(transactions[0]).toHaveProperty('slot');
        expect(transactions[0]).toHaveProperty('blockTime');
        expect(transactions[0]).toHaveProperty('meta');
        expect(transactions[0]).toHaveProperty('transaction');
        if (transactions[0].transaction) {
          expect(transactions[0].transaction).toHaveProperty('signatures');
          expect(transactions[0].transaction.signatures).toBeDefined();
          expect(Array.isArray(transactions[0].transaction.signatures)).toBe(true);
          if (transactions[0].transaction.signatures.length > 0) {
            expect(transactions[0].transaction.signatures[0]).toBeDefined();
            expect(typeof transactions[0].transaction.signatures[0]).toBe('string');
          }
          expect(transactions[0].transaction).toHaveProperty('message');
          if (transactions[0].transaction.message) {
            expect(transactions[0].transaction.message).toHaveProperty('accountKeys');
          }
        }
      }
    }, 30000);

    it('should fetch raw address transactions with since parameter successfully', async () => {
      const oneWeekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
      const result = await provider.execute<HeliusTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
        since: oneWeekAgo,
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('blockTime');
        expect(transactions[0]?.blockTime).toBeDefined();
      }
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch raw address balance successfully', async () => {
      const result = await provider.execute<{ lamports: number }>({
        address: testAddress,
        type: 'getRawAddressBalance',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balance = result.value;
      expect(balance).toHaveProperty('lamports');
      expect(typeof balance.lamports).toBe('number');
      expect(balance.lamports).toBeGreaterThanOrEqual(0);
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should fetch raw token balances successfully', async () => {
      const result = await provider.execute<{ tokenAccounts: { value: unknown[] } }>({
        address: testAddress,
        type: 'getRawTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const tokenBalances = result.value;
      expect(tokenBalances).toHaveProperty('tokenAccounts');
      expect(tokenBalances.tokenAccounts).toHaveProperty('value');
      expect(Array.isArray(tokenBalances.tokenAccounts.value)).toBe(true);

      if (tokenBalances.tokenAccounts.value.length > 0) {
        const tokenAccount = tokenBalances.tokenAccounts.value[0];
        expect(tokenAccount).toHaveProperty('pubkey');
        expect(tokenAccount).toHaveProperty('account');
        if (
          typeof tokenAccount === 'object' &&
          tokenAccount !== null &&
          'account' in tokenAccount &&
          typeof (tokenAccount as { account?: unknown }).account === 'object' &&
          (tokenAccount as { account?: unknown }).account !== null
        ) {
          const account = (tokenAccount as { account?: unknown }).account as { data?: unknown };
          expect(account).toHaveProperty('data');
          if (account.data) {
            expect(account.data as { parsed?: unknown }).toHaveProperty('parsed');
            const parsed = (account.data as { parsed?: unknown }).parsed;
            if (parsed) {
              expect(parsed as { info?: unknown }).toHaveProperty('info');
              const info = (parsed as { info?: unknown }).info;
              if (info) {
                expect(info as { mint?: unknown }).toHaveProperty('mint');
                expect(info as { tokenAmount?: unknown }).toHaveProperty('tokenAmount');
              }
            }
          }
        }
      }
    }, 30000);
  });

  describe('Token Symbol Resolution', () => {
    it('should resolve known token symbols successfully', async () => {
      // Test with USDC mint address
      const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const symbol = await provider.getTokenSymbol(usdcMint);

      expect(typeof symbol).toBe('string');
      expect(symbol.length).toBeGreaterThan(0);
      // Should return 'USDC' for the known mint
      expect(symbol).toBe('USDC');
    }, 30000);

    it('should handle unknown token addresses gracefully', async () => {
      // Test with a random address that's likely not a valid token
      const randomAddress = '11111111111111111111111111111112';
      const symbol = await provider.getTokenSymbol(randomAddress);

      expect(typeof symbol).toBe('string');
      expect(symbol.length).toBeGreaterThan(0);
      // Should return a fallback format like "111111..."
      expect(symbol).toMatch(/^\w{6}\.\.\.$/);
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle invalid addresses gracefully', async () => {
      const invalidAddress = 'invalid-address';

      const result = await provider.execute<HeliusTransaction[]>({
        address: invalidAddress,
        type: 'getRawAddressTransactions',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid Solana address');
      }
    });

    it('should handle unsupported operations gracefully', async () => {
      const result = await provider.execute<unknown>({
        address: testAddress,
        type: 'custom',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Unsupported operation: custom');
      }
    });
  });

  describe('Multi-Chain Support', () => {
    it('should support Solana chain with correct configuration', () => {
      const solanaConfig = ProviderRegistry.createDefaultConfig('solana', 'helius');
      const solanaProvider = new HeliusApiClient(solanaConfig);

      // Check that the provider was created successfully
      expect(solanaProvider).toBeDefined();
      expect(solanaProvider.blockchain).toBe('solana');
    });

    it('should initialize with correct configuration', () => {
      const heliusProvider = new HeliusApiClient(config);

      // Check that the provider was created successfully
      expect(heliusProvider).toBeDefined();
      expect(heliusProvider.blockchain).toBe('solana');
    });
  });
});
