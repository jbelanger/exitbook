import { beforeAll, describe, expect, it } from 'vitest';

import type { AddressInfo } from '../../types.js';
import { BlockCypherApiClient } from '../blockcypher.api-client.js';
import type { BlockCypherTransaction } from '../blockcypher.types.js';

describe('BlockCypherApiClient E2E', () => {
  let client: BlockCypherApiClient;

  beforeAll(() => {
    if (!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken') {
      console.warn(
        'Skipping BlockCypher E2E tests - no API key provided. Set BLOCKCYPHER_API_KEY environment variable.'
      );
      return;
    }

    client = new BlockCypherApiClient();
  });

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should connect to BlockCypher API and test health',
    async () => {
      const isHealthy = await client.isHealthy();
      expect(isHealthy).toBe(true);
    },
    30000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should get address info for known address',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address

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
    30000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should get raw address transactions',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

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
    45000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should handle empty address gracefully',
    async () => {
      const emptyAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

      const addressInfo = await client.execute<AddressInfo>({
        address: emptyAddress,
        type: 'getAddressInfo',
      });

      expect(addressInfo).toBeDefined();
      expect(addressInfo).toHaveProperty('balance');
      expect(addressInfo).toHaveProperty('txCount');
    },
    30000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should filter transactions by timestamp',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
      const futureTimestamp = Date.now() + 86400000; // 24 hours from now

      const transactions = await client.execute<BlockCypherTransaction[]>({
        address: testAddress,
        since: futureTimestamp,
        type: 'getRawAddressTransactions',
      });

      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions).toHaveLength(0);
    },
    45000
  );
});
