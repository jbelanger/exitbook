import type { TokenMetadata } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { RawBalanceData } from '../../../../../core/types/index.js';
import { MoralisApiClient } from '../moralis.api-client.js';

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
      it('should fetch address balance successfully', async () => {
        const result = await provider.execute<RawBalanceData>({
          address: testAddress,
          type: 'getAddressBalances',
        });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const balance = result.value;
          expect(balance).toBeDefined();
          expect(balance.symbol).toBe('ETH');
          expect(balance.decimals).toBe(18);
          expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
        }
      }, 30000);
    });

    describe('Token Balances', () => {
      it('should fetch token balances in normalized format with symbols', async () => {
        // Use a different address with fewer tokens to avoid Moralis's 2000 token limit
        const smallerAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4';

        const result = await provider.execute<RawBalanceData[]>({
          address: smallerAddress,
          type: 'getAddressTokenBalances',
        });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const balances = result.value;
          expect(Array.isArray(balances)).toBe(true);
          if (balances.length > 0) {
            const firstBalance = balances[0]!;
            expect(firstBalance).toHaveProperty('symbol');
            expect(firstBalance).toHaveProperty('contractAddress');
            expect(firstBalance.rawAmount || firstBalance.decimalAmount).toBeDefined();
            expect(firstBalance.decimals).toBeDefined();
            // Symbol may be undefined for some tokens
            if (firstBalance.symbol) {
              expect(firstBalance.symbol.length).toBeGreaterThan(0);
            }
            // Should have contract address for tokens
            expect(firstBalance.contractAddress).toBeTruthy();
          }
        }
      }, 30000);

      it('should convert balances from smallest units to decimal', async () => {
        const smallerAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4';

        const result = await provider.execute<RawBalanceData[]>({
          address: smallerAddress,
          type: 'getAddressTokenBalances',
        });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const balances = result.value;
          if (balances.length > 0) {
            // All balances should have either rawAmount or decimalAmount
            for (const balance of balances) {
              expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
              expect(balance.decimals).toBeDefined();
              // If decimalAmount exists, it should be a valid number
              if (balance.decimalAmount) {
                const numericValue = Number(balance.decimalAmount);
                expect(numericValue).not.toBeNaN();
                // Should be a reasonable decimal value (not in smallest units like 1000000000000000000)
                expect(numericValue).toBeLessThan(1e15);
              }
            }
          }
        }
      }, 30000);
    });

    describe('Token Metadata', () => {
      it('should fetch ERC20 token metadata successfully', async () => {
        // USDC on Ethereum
        const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

        const result = await provider.getTokenMetadata([usdcAddress]);

        expect(result.isOk()).toBe(true);
        if (result.isErr()) {
          console.error('Token metadata fetch error:', result.error.message);
          return;
        }

        const metadataArray = result.value;
        expect(Array.isArray(metadataArray)).toBe(true);
        expect(metadataArray.length).toBe(1);

        const metadata = metadataArray[0]!;
        expect(metadata).toHaveProperty('contractAddress', usdcAddress);
        expect(metadata).toHaveProperty('name');
        expect(metadata).toHaveProperty('symbol');
        expect(metadata).toHaveProperty('decimals');

        // USDC should have 6 decimals
        expect(metadata.decimals).toBe(6);
        expect(metadata.symbol).toBe('USDC');
      }, 30000);

      it('should fetch token metadata with logo URL', async () => {
        // USDT on Ethereum (known to have a logo)
        const usdtAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

        const result = await provider.getTokenMetadata([usdtAddress]);

        expect(result.isOk()).toBe(true);
        if (result.isErr()) {
          console.error('Token metadata fetch error:', result.error.message);
          return;
        }

        const metadataArray = result.value;
        expect(Array.isArray(metadataArray)).toBe(true);
        expect(metadataArray.length).toBe(1);

        const metadata = metadataArray[0]!;
        expect(metadata).toHaveProperty('contractAddress', usdtAddress);
        expect(metadata.decimals).toBe(6);

        // Logo URL may or may not be present, but if it is, it should be a valid URL
        if (metadata.logoUrl !== undefined) {
          expect(metadata.logoUrl).toMatch(/^https?:\/\//);
        }
      }, 30000);

      it('should return metadata even for zero address if Moralis has data', async () => {
        // Zero address - Moralis may or may not have metadata for this
        const zeroAddress = '0x0000000000000000000000000000000000000000';

        const result = await provider.getTokenMetadata([zeroAddress]);

        // Moralis may return data for any address, so we just verify the call completes
        // If it succeeds, verify the structure is correct
        if (result.isOk()) {
          const metadataArray = result.value;
          expect(Array.isArray(metadataArray)).toBe(true);
          if (metadataArray.length > 0) {
            const metadata = metadataArray[0]!;
            expect(metadata).toHaveProperty('contractAddress', zeroAddress);
            expect(metadata).toHaveProperty('refreshedAt');
          }
        } else {
          // If it fails, that's also acceptable
          expect(result.error.message).toBeTruthy();
        }
      }, 30000);

      it('should fetch token metadata via execute interface', async () => {
        // DAI on Ethereum
        const daiAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

        const result = await provider.execute<TokenMetadata[]>({
          contractAddresses: [daiAddress],
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
        expect(metadata).toHaveProperty('contractAddress', daiAddress);
        expect(metadata).toHaveProperty('symbol');
        expect(metadata).toHaveProperty('decimals');
        expect(metadata).toHaveProperty('refreshedAt');

        // DAI should have 18 decimals
        expect(metadata.decimals).toBe(18);
        expect(metadata.symbol).toBe('DAI');
      }, 30000);
    });
  });

  describe('Avalanche', () => {
    const config = ProviderRegistry.createDefaultConfig('avalanche', 'moralis');
    const provider = new MoralisApiClient(config);

    describe('Health Checks', () => {
      it('should report healthy when API is accessible', async () => {
        const result = await provider.isHealthy();
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value).toBe(true);
        }
      }, 30000);
    });
  });
});
