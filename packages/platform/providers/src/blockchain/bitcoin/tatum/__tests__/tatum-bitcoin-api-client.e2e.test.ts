import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { AddressInfo } from '../../types.ts';
import { TatumBitcoinApiClient } from '../tatum-bitcoin.api-client.ts';
import type { TatumBitcoinTransaction } from '../tatum.types.ts';

describe('TatumBitcoinApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'tatum');
  const provider = new TatumBitcoinApiClient(config);
  const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address

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
    'should fetch address info successfully',
    async () => {
      const result = await provider.execute<AddressInfo>({
        address: testAddress,
        type: 'getAddressInfo',
      });

      expect(result).toHaveProperty('txCount');
      expect(result).toHaveProperty('balance');
      expect(typeof result.txCount).toBe('number');
      expect(typeof result.balance).toBe('string');
    },
    30000
  );

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should fetch raw address transactions successfully',
    async () => {
      const transactions = await provider.execute<TatumBitcoinTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        expect(transactions[0]).toHaveProperty('hash');
        expect(transactions[0]).toHaveProperty('inputs');
        expect(transactions[0]).toHaveProperty('outputs');
        expect(transactions[0]).toHaveProperty('time');
      }
    },
    30000
  );
});
