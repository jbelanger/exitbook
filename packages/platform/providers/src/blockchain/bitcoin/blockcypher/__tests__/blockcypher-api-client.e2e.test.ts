import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { AddressInfo } from '../../types.js';
import { BlockCypherApiClient } from '../blockcypher.api-client.js';
import type { BlockCypherTransaction } from '../blockcypher.types.js';

describe.skip('BlockCypherApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'blockcypher');
  const client = new BlockCypherApiClient(config);
  const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should connect to BlockCypher API and test health',
    async () => {
      const result = await client.isHealthy();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    },
    30000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should get address info for known address',
    async () => {
      const addressInfo = await client.execute<AddressInfo>({
        address: testAddress,
        type: 'getAddressInfo',
      });

      expect(addressInfo).toBeDefined();
      expect(addressInfo).toHaveProperty('balance');
      expect(addressInfo).toHaveProperty('txCount');
      expect(typeof addressInfo.balance).toBe('string');
      expect(typeof addressInfo.txCount).toBe('number');
      expect(addressInfo.txCount).toBeGreaterThan(0);
    },
    60000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should get raw address transactions',
    async () => {
      const transactions = await client.execute<BlockCypherTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      if (transactions.length > 0) {
        const tx = transactions[0]!;
        expect(tx).toBeDefined();
        expect(tx.hash).toBeDefined();
        expect(typeof tx.hash).toBe('string');
        expect(Array.isArray(tx.inputs)).toBe(true);
        expect(Array.isArray(tx.outputs)).toBe(true);
      }
    },
    90000
  );
});
