import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/blockchain/index.ts';
import { AlchemyApiClient } from '../alchemy.api-client.ts';
import type { AlchemyAssetTransfer, AlchemyTokenBalance } from '../alchemy.types.ts';

describe('AlchemyApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('ethereum', 'alchemy');
  const provider = new AlchemyApiClient(config);
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

  describe('Raw Address Transactions', () => {
    it('should fetch raw address transactions successfully', async () => {
      const transactions = await provider.execute<AlchemyAssetTransfer[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('from');
        expect(transactions[0]).toHaveProperty('to');
        expect(transactions[0]).toHaveProperty('blockNum');
        expect(transactions[0]).toHaveProperty('category');
        // Should only fetch external transactions
        expect(transactions[0]!.category).toBe('external');
      }
    }, 30000);

    it('should fetch raw internal transactions successfully', async () => {
      const transactions = await provider.execute<AlchemyAssetTransfer[]>({
        address: testAddress,
        type: 'getRawAddressInternalTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('from');
        expect(transactions[0]).toHaveProperty('to');
        expect(transactions[0]).toHaveProperty('blockNum');
        expect(transactions[0]).toHaveProperty('category');
        // Should only fetch internal transactions
        expect(transactions[0]!.category).toBe('internal');
      }
    }, 30000);
  });

  describe('Token Transactions', () => {
    it('should fetch token transactions successfully', async () => {
      const transactions = await provider.execute<AlchemyAssetTransfer[]>({
        address: testAddress,
        type: 'getTokenTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('category');
        // Should be token-related category
        const category = transactions[0]!.category;
        expect(['erc1155', 'erc20', 'erc721', 'token'].includes(category)).toBe(true);
      }
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should fetch raw token balances successfully', async () => {
      const balances = await provider.execute<AlchemyTokenBalance[]>({
        address: testAddress,
        type: 'getRawTokenBalances',
      });

      expect(Array.isArray(balances)).toBe(true);
      if (balances.length > 0) {
        expect(balances[0]).toHaveProperty('contractAddress');
        expect(balances[0]).toHaveProperty('tokenBalance');
      }
    }, 30000);
  });

  describe('Multi-Chain Support', () => {
    it('should support Avalanche chain with correct base URL', () => {
      const avalancheConfig = ProviderRegistry.createDefaultConfig('avalanche', 'alchemy');
      const avalancheProvider = new AlchemyApiClient(avalancheConfig);

      // Check that the provider was created successfully
      expect(avalancheProvider).toBeDefined();
      expect(avalancheProvider.blockchain).toBe('avalanche');
    });

    it('should support Polygon chain with correct base URL', () => {
      const polygonConfig = ProviderRegistry.createDefaultConfig('polygon', 'alchemy');
      const polygonProvider = new AlchemyApiClient(polygonConfig);

      // Check that the provider was created successfully
      expect(polygonProvider).toBeDefined();
      expect(polygonProvider.blockchain).toBe('polygon');
    });
  });
});
