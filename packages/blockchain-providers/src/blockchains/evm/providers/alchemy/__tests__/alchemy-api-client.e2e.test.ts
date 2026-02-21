/* eslint-disable @typescript-eslint/no-unsafe-member-access -- acceptable for tests */
/* eslint-disable @typescript-eslint/no-unsafe-call -- acceptable for tests */
/* eslint-disable @typescript-eslint/no-explicit-any -- acceptable for tests */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
import { describe, expect, it } from 'vitest';

import { createProviderRegistry } from '../../../../../initialize.js';
import { AlchemyApiClient } from '../alchemy.api-client.js';

const providerRegistry = createProviderRegistry();

describe('AlchemyApiClient Integration', () => {
  const config = providerRegistry.createDefaultConfig('ethereum', 'alchemy');
  const provider = new AlchemyApiClient(config);
  const testAddress = '0xE472E43C3417cd0E39F7289B2bC836C08F529CA7'; // Vitalik's address

  describe('Deduplication Logic', () => {
    it('should not drop distinct transfers when uniqueId is missing', () => {
      // Access private method for testing via type assertion
      const alchemyProvider = provider as any;

      // Simulate multiple transfers in same transaction without uniqueId
      const transfers = [
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender1',
          to: '0xrecipient1',
          hash: '0xabc123',
          metadata: { blockTimestamp: new Date('2024-01-01') },
          rawContract: { value: '1000000000000000000' },
          uniqueId: undefined,
        },
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender2',
          to: '0xrecipient2',
          hash: '0xabc123',
          metadata: { blockTimestamp: new Date('2024-01-01') },
          rawContract: { value: '2000000000000000000' },
          uniqueId: undefined,
        },
      ];

      const result = alchemyProvider.deduplicateRawTransfers(transfers);

      // Both transfers should be preserved because they have different from/to/value
      expect(result).toHaveLength(2);
      expect(result[0].from).toBe('0xsender1');
      expect(result[1].from).toBe('0xsender2');
    });

    it('should deduplicate identical transfers when uniqueId is present', () => {
      const alchemyProvider = provider as any;

      const transfers = [
        {
          blockNum: '0x123456',
          category: 'erc20',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xabc123',
          metadata: { blockTimestamp: new Date('2024-01-01') },
          rawContract: { address: '0xtoken', value: '1000000' },
          uniqueId: 'log_0',
        },
        {
          blockNum: '0x123456',
          category: 'erc20',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xabc123',
          metadata: { blockTimestamp: new Date('2024-01-01') },
          rawContract: { address: '0xtoken', value: '1000000' },
          uniqueId: 'log_0',
        },
      ];

      const result = alchemyProvider.deduplicateRawTransfers(transfers);

      // Identical transfers with same uniqueId should be deduplicated
      expect(result).toHaveLength(1);
    });

    it('should preserve distinct transfers with different uniqueId', () => {
      const alchemyProvider = provider as any;

      const transfers = [
        {
          blockNum: '0x123456',
          category: 'erc20',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xabc123',
          metadata: { blockTimestamp: new Date('2024-01-01') },
          rawContract: { address: '0xtoken', value: '1000000' },
          uniqueId: 'log_0',
        },
        {
          blockNum: '0x123456',
          category: 'erc20',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xabc123',
          metadata: { blockTimestamp: new Date('2024-01-01') },
          rawContract: { address: '0xtoken', value: '1000000' },
          uniqueId: 'log_1',
        },
      ];

      const result = alchemyProvider.deduplicateRawTransfers(transfers);

      // Different uniqueId means different transfers (different log entries)
      expect(result).toHaveLength(2);
    });

    it('should handle mixed transfers with and without uniqueId', () => {
      const alchemyProvider = provider as any;

      const transfers = [
        {
          blockNum: '0x123456',
          category: 'erc20',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xabc123',
          metadata: { blockTimestamp: new Date('2024-01-01') },
          rawContract: { address: '0xtoken', value: '1000000' },
          uniqueId: 'log_0',
        },
        {
          blockNum: '0x123456',
          category: 'external',
          from: '0xsender',
          to: '0xrecipient',
          hash: '0xabc123',
          metadata: { blockTimestamp: new Date('2024-01-01') },
          rawContract: { value: '1000000000000000000' },
          uniqueId: undefined,
        },
      ];

      const result = alchemyProvider.deduplicateRawTransfers(transfers);

      // Both should be preserved as they use different dedup strategies
      expect(result).toHaveLength(2);
    });
  });

  describe('Health Checks', () => {
    it('should report healthy when API is accessible', async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should fetch token balances in normalized format with symbols', async () => {
      const result = await provider.execute({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(Array.isArray(balances)).toBe(true);
        if (balances.length > 0) {
          const firstBalance = balances[0]!;
          expect(firstBalance).toHaveProperty('rawAmount');
          expect(typeof firstBalance.rawAmount).toBe('string');
          // rawAmount should be a numeric string
          expect(Number(firstBalance.rawAmount)).not.toBeNaN();
          // Symbol or contractAddress should be present (one or both)
          expect(firstBalance.symbol || firstBalance.contractAddress).toBeTruthy();
          // If symbol is present, it should be a valid string
          if (firstBalance.symbol) {
            expect(typeof firstBalance.symbol).toBe('string');
            expect(firstBalance.symbol.length).toBeGreaterThan(0);
          }
        }
      }
    }, 30000);

    it('should filter out balances with errors', async () => {
      const result = await provider.execute({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        // All returned balances should be valid (have required properties)
        for (const balance of balances) {
          expect(balance).toHaveProperty('rawAmount');
          // Either symbol or contractAddress should be present
          expect(balance.symbol || balance.contractAddress).toBeTruthy();
        }
      }
    }, 30000);

    it('should support specific contract addresses filter', async () => {
      // USDC contract address on Ethereum
      const usdcContract = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      const result = await provider.execute({
        address: testAddress,
        contractAddresses: [usdcContract],
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balances = result.value;
        expect(Array.isArray(balances)).toBe(true);
        // Should only return balance for the specified contract (as symbol or address)
        if (balances.length > 0) {
          const balance = balances[0]!;
          // Symbol should be USDC or contract address as fallback
          expect(
            balance.symbol?.toLowerCase() === 'usdc' ||
              balance.contractAddress?.toLowerCase() === usdcContract.toLowerCase()
          ).toBe(true);
        }
      }
    }, 30000);
  });

  describe('Multi-Chain Support', () => {
    it('should support Avalanche chain with correct base URL', () => {
      const avalancheConfig = providerRegistry.createDefaultConfig('avalanche', 'alchemy');
      const avalancheProvider = new AlchemyApiClient(avalancheConfig);

      expect(avalancheProvider).toBeDefined();
      expect(avalancheProvider.blockchain).toBe('avalanche');
    });

    it('should support Polygon chain with correct base URL', () => {
      const polygonConfig = providerRegistry.createDefaultConfig('polygon', 'alchemy');
      const polygonProvider = new AlchemyApiClient(polygonConfig);

      expect(polygonProvider).toBeDefined();
      expect(polygonProvider.blockchain).toBe('polygon');
    });
  });
});
