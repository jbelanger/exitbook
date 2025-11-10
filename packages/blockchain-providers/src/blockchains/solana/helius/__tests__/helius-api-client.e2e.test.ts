import type { TokenMetadata } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/index.js';
import type { RawBalanceData, TransactionWithRawData } from '../../../../core/types/index.js';
import type { SolanaTransaction } from '../../types.js';
import { lamportsToSol } from '../../utils.js';
import { HeliusApiClient } from '../helius.api-client.js';
import type { HeliusTransaction } from '../helius.schemas.js';

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

      if (result.isErr()) {
        console.error('Transaction fetch error:', result.error.message);
        console.error('Full error:', result.error);
      }
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
        expect(normalized.providerName).toBe('helius');
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
    }, 60000); // Increased timeout to 60 seconds for API calls

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
  });

  describe('Address Balance', () => {
    it('should fetch address balance in normalized format', async () => {
      const result = await provider.execute<RawBalanceData>({
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
    it('should fetch token balances in normalized format', async () => {
      const result = await provider.execute<RawBalanceData[]>({
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
        expect(firstBalance.decimals).toBeDefined();
        // If decimalAmount is present, it should be valid
        if (firstBalance.decimalAmount) {
          const numericTotal = Number(firstBalance.decimalAmount);
          expect(numericTotal).not.toBeNaN();
          expect(numericTotal).toBeGreaterThanOrEqual(0);
        }
      }
    }, 30000);

    it('should return token balances with UI amount strings', async () => {
      const result = await provider.execute<RawBalanceData[]>({
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

  describe('Token Metadata', () => {
    it('should fetch NFT metadata successfully', async () => {
      // Mad Lads NFT #8420 from the example
      const nftMintAddress = 'F9Lw3ki3hJ7PF9HQXsBzoY8GyE6sPoEZZdXJBsTTD2rk';

      const result = await provider.getTokenMetadata(nftMintAddress);

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        console.error('NFT metadata fetch error:', result.error.message);
        return;
      }

      const metadata = result.value;
      expect(metadata).toHaveProperty('contractAddress', nftMintAddress);
      expect(metadata).toHaveProperty('name');
      expect(metadata).toHaveProperty('symbol');

      // NFTs typically have decimals of 0
      if (metadata.decimals !== undefined) {
        expect(metadata.decimals).toBe(0);
      }

      // Should have a logo URL
      if (metadata.logoUrl !== undefined) {
        expect(metadata.logoUrl).toMatch(/^https?:\/\//);
      }
    }, 30000);

    it('should fetch fungible token metadata successfully', async () => {
      // USDC on Solana
      const usdcMintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      const result = await provider.getTokenMetadata(usdcMintAddress);

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        console.error('Fungible token metadata fetch error:', result.error.message);
        return;
      }

      const metadata = result.value;
      expect(metadata).toHaveProperty('contractAddress', usdcMintAddress);

      // USDC should have 6 decimals
      if (metadata.decimals !== undefined) {
        expect(metadata.decimals).toBe(6);
      }
    }, 30000);

    it('should handle non-existent token gracefully', async () => {
      const invalidMintAddress = '11111111111111111111111111111111';

      const result = await provider.getTokenMetadata(invalidMintAddress);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Token metadata not found');
      }
    }, 30000);

    it('should fetch token metadata via execute interface', async () => {
      // USDT on Solana
      const usdtMintAddress = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

      const result = await provider.execute<TokenMetadata>({
        contractAddress: usdtMintAddress,
        type: 'getTokenMetadata',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        console.error('Token metadata fetch error:', result.error.message);
        return;
      }

      const metadata = result.value;
      expect(metadata).toHaveProperty('contractAddress', usdtMintAddress);
      expect(metadata).toHaveProperty('refreshedAt');

      // USDT should have 6 decimals
      if (metadata.decimals !== undefined) {
        expect(metadata.decimals).toBe(6);
      }
    }, 30000);
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
