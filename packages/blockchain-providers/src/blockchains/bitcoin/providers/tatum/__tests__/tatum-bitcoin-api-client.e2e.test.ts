import { describe, expect, it } from 'vitest';

import { createProviderRegistry } from '../../../../../initialize.js';
import { TatumBitcoinApiClient } from '../tatum-bitcoin.api-client.js';

const providerRegistry = createProviderRegistry();

describe('TatumBitcoinApiClient E2E', () => {
  const config = providerRegistry.createDefaultConfig('bitcoin', 'tatum');
  const provider = new TatumBitcoinApiClient(config);
  const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address
  const emptyAddress = 'bc1qeppvcnauqak9xn7mmekw4crr79tl9c8lnxpp2k'; // Address with no transactions

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should report healthy when API is accessible',
    async () => {
      const result = await provider.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    },
    30000
  );

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should fetch address balance successfully',
    async () => {
      const result = await provider.execute({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance.symbol).toBe('BTC');
        expect(balance.decimals).toBe(8);
        expect(balance.rawAmount || balance.decimalAmount).toBeDefined();
      }
    },
    30000
  );

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should return true for address with transactions',
    async () => {
      const result = await provider.execute({
        address: testAddress,
        type: 'hasAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    },
    30000
  );

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should return false for address without transactions',
    async () => {
      const result = await provider.execute({
        address: emptyAddress,
        type: 'hasAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    },
    30000
  );
});
