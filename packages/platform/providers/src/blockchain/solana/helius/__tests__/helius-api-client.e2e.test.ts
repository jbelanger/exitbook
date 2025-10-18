import type { BlockchainBalanceSnapshot, BlockchainTokenBalanceSnapshot } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../core/blockchain/types/index.ts';
import type { SolanaTransaction } from '../../types.ts';
import { lamportsToSol } from '../../utils.ts';
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

  describe('Address Transactions with Normalization', () => {
    it('should fetch and normalize transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<SolanaTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        const txData = transactions[0]!;

        expect(txData).toHaveProperty('raw');
        expect(txData).toHaveProperty('normalized');

        const raw = txData.raw as HeliusTransaction;
        expect(raw).toHaveProperty('slot');
        expect(raw).toHaveProperty('blockTime');
        expect(raw).toHaveProperty('meta');
        expect(raw).toHaveProperty('transaction');
        expect(raw.transaction).toHaveProperty('signatures');
        expect(raw.transaction).toHaveProperty('message');

        const normalized = txData.normalized;
        expect(normalized.providerId).toBe('helius');
        expect(typeof normalized.id).toBe('string');
        expect(normalized.id.length).toBeGreaterThan(0);
        expect(['success', 'failed']).toContain(normalized.status);
        expect(typeof normalized.amount).toBe('string');
        expect(typeof normalized.currency).toBe('string');
        expect(normalized.slot).toBe(raw.slot);
        expect(normalized.timestamp).toBeGreaterThan(0);

        const expectedSignature = raw.transaction.signatures?.[0] ?? raw.signature;
        expect(normalized.id).toBe(expectedSignature);
        expect(normalized.blockHeight).toBe(raw.slot);
      }
    }, 30000);

    it('should include account balance changes in normalized transactions', async () => {
      const result = await provider.execute<TransactionWithRawData<SolanaTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      const txWithBalanceChanges = transactions.find(
        (tx) => tx.normalized.accountChanges && tx.normalized.accountChanges.length > 0
      );

      if (!txWithBalanceChanges) {
        console.warn('No transactions with balance changes found, skipping test');
        return;
      }

      const normalized = txWithBalanceChanges.normalized;
      expect(Array.isArray(normalized.accountChanges)).toBe(true);
      expect(normalized.accountChanges!.length).toBeGreaterThan(0);

      const change = normalized.accountChanges![0]!;
      expect(typeof change.account).toBe('string');
      expect(typeof change.preBalance).toBe('string');
      expect(typeof change.postBalance).toBe('string');
    }, 30000);

    it('should include token changes when present', async () => {
      const result = await provider.execute<TransactionWithRawData<SolanaTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      const txWithTokenChanges = transactions.find(
        (tx) => tx.normalized.tokenChanges && tx.normalized.tokenChanges.length > 0
      );

      if (!txWithTokenChanges) {
        console.warn('No transactions with token changes found, skipping test');
        return;
      }

      const normalized = txWithTokenChanges.normalized;
      expect(Array.isArray(normalized.tokenChanges)).toBe(true);
      expect(normalized.tokenChanges!.length).toBeGreaterThan(0);

      const tokenChange = normalized.tokenChanges![0]!;
      expect(typeof tokenChange.mint).toBe('string');
      expect(typeof tokenChange.preAmount).toBe('string');
      expect(typeof tokenChange.postAmount).toBe('string');
      expect(typeof tokenChange.decimals).toBe('number');
    }, 30000);

    it('should convert fees from lamports to SOL', async () => {
      const result = await provider.execute<TransactionWithRawData<SolanaTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      if (transactions.length > 0) {
        const txData = transactions[0]!;
        const raw = txData.raw as HeliusTransaction;
        const normalized = txData.normalized;

        expect(normalized.feeCurrency).toBe('SOL');
        expect(normalized.feeAmount).toBe(lamportsToSol(raw.meta.fee).toString());
      }
    }, 30000);

    it('should filter transactions by since parameter', async () => {
      // Use a date far enough in the past that we know there are transactions
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const result = await provider.execute<TransactionWithRawData<SolanaTransaction>[]>({
        address: testAddress,
        since: oneYearAgo,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      expect(Array.isArray(transactions)).toBe(true);

      // All returned transactions should be after the since timestamp
      transactions.forEach((txData) => {
        expect(txData.normalized.timestamp).toBeGreaterThanOrEqual(oneYearAgo);
      });
    }, 30000);
  });

  describe('Address Balance', () => {
    it('should fetch address balance in normalized format', async () => {
      const result = await provider.execute<BlockchainBalanceSnapshot>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balance = result.value;
      expect(balance).toHaveProperty('total');
      expect(typeof balance.total).toBe('string');
      // Total should be in SOL (converted from lamports)
      const numericBalance = Number(balance.total);
      expect(numericBalance).not.toBeNaN();
      expect(numericBalance).toBeGreaterThanOrEqual(0);
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should fetch token balances in normalized format', async () => {
      const result = await provider.execute<BlockchainTokenBalanceSnapshot[]>({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balances = result.value;
      expect(Array.isArray(balances)).toBe(true);

      if (balances.length > 0) {
        const firstBalance = balances[0]!;
        expect(firstBalance).toHaveProperty('token');
        expect(firstBalance).toHaveProperty('total');
        expect(typeof firstBalance.token).toBe('string');
        expect(typeof firstBalance.total).toBe('string');
        // Token should be a mint address (base58 encoded)
        expect(firstBalance.token.length).toBeGreaterThan(32);
        // Total should be a numeric string (in UI amount format)
        const numericTotal = Number(firstBalance.total);
        expect(numericTotal).not.toBeNaN();
        expect(numericTotal).toBeGreaterThanOrEqual(0);
      }
    }, 30000);

    it('should return token balances with UI amount strings', async () => {
      const result = await provider.execute<BlockchainTokenBalanceSnapshot[]>({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balances = result.value;

      if (balances.length > 0) {
        // All balances should have human-readable amounts (not raw token amounts)
        for (const balance of balances) {
          const numericValue = Number(balance.total);
          expect(numericValue).not.toBeNaN();
          // Should be a reasonable value (not raw lamports/smallest units)
          expect(balance.total).not.toMatch(/^[0-9]{15,}$/); // Not a huge integer
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
        type: 'getAddressTransactions',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid Solana address');
      }
    });

    it('should handle unsupported operations gracefully', async () => {
      const result = await provider.execute<unknown>({
        address: testAddress,
        type: 'non-existent' as never,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Unsupported operation: non-existent');
      }
    });
  });

  describe('Multi-Chain Support', () => {
    it('should support Solana chain with correct configuration', () => {
      const solanaConfig = ProviderRegistry.createDefaultConfig('solana', 'helius');
      const solanaProvider = new HeliusApiClient(solanaConfig);

      expect(solanaProvider).toBeDefined();
      expect(solanaProvider.blockchain).toBe('solana');
    });

    it('should initialize with correct configuration', () => {
      const heliusProvider = new HeliusApiClient(config);

      expect(heliusProvider).toBeDefined();
      expect(heliusProvider.blockchain).toBe('solana');
    });
  });
});
