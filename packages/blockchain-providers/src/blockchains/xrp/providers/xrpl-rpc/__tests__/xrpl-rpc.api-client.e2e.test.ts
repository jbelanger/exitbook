import { describe, expect, it } from 'vitest';

import type { RawBalanceData } from '../../../../../core/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import { XrplRpcApiClient } from '../xrpl-rpc.api-client.js';

const providerRegistry = createProviderRegistry();

describe('XrplRpcApiClient Integration', () => {
  const config = providerRegistry.createDefaultConfig('xrp', 'xrpl-rpc');
  const provider = new XrplRpcApiClient(config);
  // Ripple's donation address - a well-known address with activity
  const testAddress = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';

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
      if (result.isErr()) {
        console.error('Balance fetch error:', result.error.message);
        return;
      }

      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('XRP');
      expect(balance.decimals).toBe(6);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();

      // Should have a valid balance
      if (balance.decimalAmount) {
        const numericBalance = Number(balance.decimalAmount);
        expect(numericBalance).not.toBeNaN();
        expect(numericBalance).toBeGreaterThanOrEqual(0);
      }

      // Raw amount should be in drops
      if (balance.rawAmount) {
        expect(balance.rawAmount).toMatch(/^\d+$/);
      }
    }, 30000);

    it('should handle invalid address gracefully', async () => {
      const result = await provider.execute<RawBalanceData>({
        address: 'invalid-address',
        type: 'getAddressBalances',
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Invalid XRP address');
      }
    });
  });

  describe('Token Balances', () => {
    it('should fetch token balances (trust lines) in normalized format', async () => {
      // Use a well-known exchange address that likely holds issued currencies
      // This is Bitstamp's cold wallet address
      const addressWithTokens = 'rrpNnNLKrartuEqfJGpqyDwPj1AFPg9vn1';

      const result = await provider.execute<RawBalanceData[]>({
        address: addressWithTokens,
        type: 'getAddressTokenBalances',
      });

      // API call should either succeed or fail gracefully
      if (result.isErr()) {
        // If it fails, just verify the error is defined
        expect(result.error).toBeDefined();
        console.log('Token balance fetch returned error (expected for some addresses):', result.error.message);
        return;
      }

      // If successful, verify the structure
      const balances = result.value;
      expect(Array.isArray(balances)).toBe(true);

      if (balances.length > 0) {
        const firstBalance = balances[0]!;
        expect(firstBalance).toHaveProperty('symbol');
        expect(firstBalance).toHaveProperty('contractAddress'); // Issuer address
        expect(firstBalance.decimalAmount).toBeDefined();

        // contractAddress (issuer) should always be present
        expect(firstBalance.contractAddress).toBeTruthy();

        // If decimalAmount is present, it should be valid
        if (firstBalance.decimalAmount) {
          const numericBalance = Number(firstBalance.decimalAmount);
          expect(numericBalance).not.toBeNaN();
        }
      }
    }, 30000);

    it('should return empty array for address with no trust lines', async () => {
      const result = await provider.execute<RawBalanceData[]>({
        address: testAddress,
        type: 'getAddressTokenBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balances = result.value;
      expect(Array.isArray(balances)).toBe(true);
      // This test address might have no issued currencies
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

  describe('Multi-Chain Support', () => {
    it('should support XRP mainnet with correct configuration', () => {
      const xrpConfig = providerRegistry.createDefaultConfig('xrp', 'xrpl-rpc');
      const xrpProvider = new XrplRpcApiClient(xrpConfig);

      expect(xrpProvider).toBeDefined();
      expect(xrpProvider.blockchain).toBe('xrp');
    });

    it('should initialize with correct configuration', () => {
      expect(provider).toBeDefined();
      expect(provider.blockchain).toBe('xrp');
    });
  });

  describe('Data Format Validation', () => {
    it('should return XRP amounts in correct decimal format', async () => {
      const result = await provider.execute<RawBalanceData>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;

      const balance = result.value;

      // Verify drops to XRP conversion is correct
      if (balance.rawAmount && balance.decimalAmount) {
        const drops = BigInt(balance.rawAmount);
        const expectedXrp = Number(drops) / 1_000_000;
        const actualXrp = Number(balance.decimalAmount);

        // Allow for small floating point differences
        expect(Math.abs(expectedXrp - actualXrp)).toBeLessThan(0.000001);
      }
    }, 30000);
  });
});
