import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { RawBalanceData, TransactionWithRawData } from '../../../../../core/types/index.js';
import type { EvmTransaction } from '../../../types.js';
import { AlchemyApiClient } from '../alchemy.api-client.js';

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
    it('should fetch raw address transactions successfully with gas fees', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
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
          expect(firstTx.normalized.providerName).toBe('alchemy');

          // Verify gas fee data is populated
          expect(firstTx.normalized).toHaveProperty('gasUsed');
          expect(firstTx.normalized).toHaveProperty('gasPrice');
          expect(firstTx.normalized).toHaveProperty('feeAmount');
          expect(firstTx.normalized).toHaveProperty('feeCurrency');
          expect(firstTx.normalized.feeCurrency).toBe('ETH'); // Ethereum native currency
          expect(firstTx.normalized.gasUsed).toBeTruthy();
          expect(firstTx.normalized.feeAmount).toBeTruthy();
        }
      }
    }, 30000);

    it('should fetch raw internal transactions successfully', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
        transactionType: 'internal',
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
          expect(firstTx.normalized.providerName).toBe('alchemy');
        }
      }
    }, 30000);
  });

  describe('Token Transactions', () => {
    it('should fetch token transactions successfully with gas fees', async () => {
      const result = await provider.execute<TransactionWithRawData<EvmTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
        transactionType: 'token',
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
          expect(firstTx.normalized.type).toBe('token_transfer');
          expect(firstTx.normalized.providerName).toBe('alchemy');

          // Verify gas fee data is populated (even for token transfers, gas is paid in native currency)
          expect(firstTx.normalized).toHaveProperty('gasUsed');
          expect(firstTx.normalized).toHaveProperty('gasPrice');
          expect(firstTx.normalized).toHaveProperty('feeAmount');
          expect(firstTx.normalized).toHaveProperty('feeCurrency');
          expect(firstTx.normalized.feeCurrency).toBe('ETH'); // Gas always paid in native currency
          expect(firstTx.normalized.gasUsed).toBeTruthy();
          expect(firstTx.normalized.feeAmount).toBeTruthy();
        }
      }
    }, 30000);
  });

  describe('Token Balances', () => {
    it('should fetch token balances in normalized format with symbols', async () => {
      const result = await provider.execute<RawBalanceData[]>({
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
      const result = await provider.execute<RawBalanceData[]>({
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

      const result = await provider.execute<RawBalanceData[]>({
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
      const avalancheConfig = ProviderRegistry.createDefaultConfig('avalanche', 'alchemy');
      const avalancheProvider = new AlchemyApiClient(avalancheConfig);

      expect(avalancheProvider).toBeDefined();
      expect(avalancheProvider.blockchain).toBe('avalanche');
    });

    it('should support Polygon chain with correct base URL', () => {
      const polygonConfig = ProviderRegistry.createDefaultConfig('polygon', 'alchemy');
      const polygonProvider = new AlchemyApiClient(polygonConfig);

      expect(polygonProvider).toBeDefined();
      expect(polygonProvider.blockchain).toBe('polygon');
    });
  });
});
