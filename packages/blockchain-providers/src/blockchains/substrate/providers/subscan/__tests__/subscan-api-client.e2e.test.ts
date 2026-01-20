import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { RawBalanceData } from '../../../../../core/types/index.js';
import { SubscanApiClient } from '../subscan.api-client.js';

describe('SubscanApiClient Integration', () => {
  const config = ProviderRegistry.createDefaultConfig('polkadot', 'subscan');
  const provider = new SubscanApiClient(config);
  // Test address with some activity but not too much (to avoid rate limiting)
  // This is a known address from Polkadot Wiki with limited transactions
  const testAddress = '1zugcavYA9yCuYwiEYeMHNJm9gXznYjNfXQjZsZukF1Mpow';

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
    it('should fetch raw address balance successfully', async () => {
      const result = await provider.execute<RawBalanceData>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }

      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('DOT');
      expect(balance.decimals).toBe(10);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();

      // Balance should be a valid decimal number
      if (balance.decimalAmount) {
        const numericValue = parseFloat(balance.decimalAmount);
        expect(numericValue).not.toBeNaN();
        expect(numericValue).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });
});
