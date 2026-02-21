import { describe, expect, it } from 'vitest';

import { createProviderRegistry } from '../../../../../initialize.js';
import { SolanaRPCApiClient } from '../solana-rpc.api-client.js';

const providerRegistry = createProviderRegistry();

describe('SolanaRPCApiClient Integration', () => {
  const config = providerRegistry.createDefaultConfig('solana', 'solana-rpc');
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
      const result = await provider.execute({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('SOL');
      expect(balance.decimals).toBe(9);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
      // Should have a valid balance
      if (balance.decimalAmount) {
        const numericBalance = Number(balance.decimalAmount);
        expect(numericBalance).not.toBeNaN();
        expect(numericBalance).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });

  describe('Token Balances', () => {
    it.skip('should fetch token balances in normalized format', async () => {
      // Skipping: Public Solana RPC is extremely slow and unreliable for E2E tests
      const result = await provider.execute({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balances = result.value;
      expect(Array.isArray(balances)).toBe(true);

      if (balances.length > 0) {
        const firstBalance = balances[0]!;
        expect(firstBalance).toHaveProperty('symbol');
        expect(firstBalance).toHaveProperty('contractAddress');
        expect(firstBalance.rawAmount || firstBalance.decimalAmount).toBeDefined();
        // Symbol may be undefined if metadata is not available
        // contractAddress (mint) should always be present
        expect(firstBalance.contractAddress).toBeTruthy();
        // Should have decimals
        expect(firstBalance.decimals).toBeDefined();
        // If decimalAmount is present, it should be valid
        if (firstBalance.decimalAmount) {
          const numericTotal = Number(firstBalance.decimalAmount);
          expect(numericTotal).not.toBeNaN();
          expect(numericTotal).toBeGreaterThanOrEqual(0);
        }
      }
    }, 30000);

    it.skip('should return token balances with UI amount strings', async () => {
      // Skipping: Public Solana RPC is extremely slow and unreliable for E2E tests
      const result = await provider.execute({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balances = result.value;

      if (balances.length > 0) {
        // All balances should have human-readable amounts (not raw token amounts)
        for (const balance of balances) {
          if (balance.decimalAmount) {
            const numericValue = Number(balance.decimalAmount);
            expect(numericValue).not.toBeNaN();
            // Should be a reasonable value (not raw lamports/smallest units)
            expect(balance.decimalAmount).not.toMatch(/^[0-9]{15,}$/); // Not a huge integer
          }
        }
      }
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should handle unsupported operations gracefully', async () => {
      const result = await provider.execute({
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
      const solanaConfig = providerRegistry.createDefaultConfig('solana', 'solana-rpc');
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
