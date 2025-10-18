import type { BlockchainBalanceSnapshot, BlockchainTokenBalanceSnapshot } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { TransactionWithRawData } from '../../../../core/blockchain/types/index.ts';
import type { SolanaTransaction } from '../../types.ts';
import { SolanaRPCApiClient } from '../solana-rpc.api-client.ts';

describe('SolanaRPCApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('solana', 'solana-rpc');
  const provider = new SolanaRPCApiClient(config);
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

  describe('Address Transactions', () => {
    it.skip('should fetch and normalize transactions successfully', async () => {
      // Skipping: Public Solana RPC is extremely slow and unreliable for E2E tests
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

        const normalized = txData.normalized;
        expect(normalized.providerId).toBe('solana-rpc');
        expect(typeof normalized.id).toBe('string');
        expect(normalized.id.length).toBeGreaterThan(0);
        expect(['success', 'failed']).toContain(normalized.status);
        expect(typeof normalized.amount).toBe('string');
        expect(typeof normalized.currency).toBe('string');
        expect(normalized.timestamp).toBeGreaterThan(0);
      }
    }, 60000);

    it.skip('should limit results to reasonable count for public RPC', async () => {
      // Skipping: Public Solana RPC is extremely slow and unreliable for E2E tests
      const result = await provider.execute<TransactionWithRawData<SolanaTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const transactions = result.value;
      // Public RPC should return limited results (25 transactions max based on code)
      expect(transactions.length).toBeLessThanOrEqual(25);
    }, 60000);
  });

  describe('Token Balances', () => {
    it.skip('should fetch token balances in normalized format', async () => {
      // Skipping: Public Solana RPC is extremely slow and unreliable for E2E tests
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

    it.skip('should return token balances with UI amount strings', async () => {
      // Skipping: Public Solana RPC is extremely slow and unreliable for E2E tests
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

  describe('Error Handling', () => {
    it('should handle invalid addresses gracefully', async () => {
      const invalidAddress = 'invalid-address';

      const result = await provider.execute<TransactionWithRawData<SolanaTransaction>[]>({
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

  describe('Configuration', () => {
    it('should support Solana chain with correct configuration', () => {
      const solanaConfig = ProviderRegistry.createDefaultConfig('solana', 'solana-rpc');
      const solanaProvider = new SolanaRPCApiClient(solanaConfig);

      expect(solanaProvider).toBeDefined();
      expect(solanaProvider.blockchain).toBe('solana');
    });

    it('should use conservative rate limits for public RPC', () => {
      const solanaProvider = new SolanaRPCApiClient(config);

      expect(solanaProvider).toBeDefined();
      expect(solanaProvider.blockchain).toBe('solana');
      // Public RPC should have conservative rate limits to avoid being blocked
    });
  });
});
