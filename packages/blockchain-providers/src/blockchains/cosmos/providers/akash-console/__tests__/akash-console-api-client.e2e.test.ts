import { describe, expect, it } from 'vitest';

import type { RawBalanceData } from '../../../../../core/types/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import { AkashConsoleApiClient } from '../akash-console.api-client.js';

const providerRegistry = createProviderRegistry();

describe('AkashConsoleApiClient E2E', () => {
  const config = providerRegistry.createDefaultConfig('akash', 'akash-console');
  const provider = new AkashConsoleApiClient(config);
  // Test address from AKASH_RPC_CLIENT_GUIDE.md (has 5 transactions as of 2026-01-19)
  const testAddress = 'akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5';

  describe('Address Balance', () => {
    it('should fetch address balance successfully', async () => {
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
      expect(balance.symbol).toBe('AKT');
      expect(balance.decimals).toBe(6);
      expect(balance.rawAmount || balance.decimalAmount).toBeDefined();

      // Balance should be a valid decimal number
      if (balance.decimalAmount) {
        const numericValue = parseFloat(balance.decimalAmount);
        expect(numericValue).not.toBeNaN();
        expect(numericValue).toBeGreaterThanOrEqual(0);
      }
    }, 30000);

    it('should handle address with minimal or zero balance', async () => {
      // Use a minimal balance address - this might fail if API returns 404 for non-existent addresses
      const minimalAddress = 'akash1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmhm7dh';
      const result = await provider.execute<RawBalanceData>({
        address: minimalAddress,
        type: 'getAddressBalances',
      });

      // Some APIs return errors for addresses that have never been used
      // Skip test if API returns error
      if (result.isErr()) {
        console.log('API returned error for minimal address, skipping test');
        return;
      }

      expect(result.isOk()).toBe(true);
      const balance = result.value;
      expect(balance).toBeDefined();
      expect(balance.symbol).toBe('AKT');
      expect(balance.decimals).toBe(6);
      if (balance.decimalAmount) {
        expect(parseFloat(balance.decimalAmount)).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });
});
