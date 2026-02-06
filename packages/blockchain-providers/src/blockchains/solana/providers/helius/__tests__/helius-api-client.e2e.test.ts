import type { TokenMetadata } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { RawBalanceData } from '../../../../../core/index.js';
import { ProviderRegistry } from '../../../../../core/index.js';
import { HeliusApiClient } from '../helius.api-client.js';

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

      const result = await provider.getTokenMetadata([nftMintAddress]);

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        console.error('NFT metadata fetch error:', result.error.message);
        return;
      }

      const metadataArray = result.value;
      expect(Array.isArray(metadataArray)).toBe(true);
      expect(metadataArray.length).toBe(1);

      const metadata = metadataArray[0]!;
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

      const result = await provider.getTokenMetadata([usdcMintAddress]);

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        console.error('Fungible token metadata fetch error:', result.error.message);
        return;
      }

      const metadataArray = result.value;
      expect(Array.isArray(metadataArray)).toBe(true);
      expect(metadataArray.length).toBe(1);

      const metadata = metadataArray[0]!;
      expect(metadata).toHaveProperty('contractAddress', usdcMintAddress);

      // USDC should have 6 decimals
      if (metadata.decimals !== undefined) {
        expect(metadata.decimals).toBe(6);
      }
    }, 30000);

    it('should handle non-existent token gracefully', async () => {
      const invalidMintAddress = '11111111111111111111111111111111';

      const result = await provider.getTokenMetadata([invalidMintAddress]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Token metadata not found');
      }
    }, 30000);

    it('should fetch token metadata via execute interface', async () => {
      // USDT on Solana
      const usdtMintAddress = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

      const result = await provider.execute<TokenMetadata[]>({
        contractAddresses: [usdtMintAddress],
        type: 'getTokenMetadata',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        console.error('Token metadata fetch error:', result.error.message);
        return;
      }

      const metadataArray = result.value;
      expect(Array.isArray(metadataArray)).toBe(true);
      expect(metadataArray.length).toBe(1);

      const metadata = metadataArray[0]!;
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
