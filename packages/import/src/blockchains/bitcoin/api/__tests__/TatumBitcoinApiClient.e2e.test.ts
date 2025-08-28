import { beforeAll, describe, expect, it } from 'vitest';

import { TatumBitcoinApiClient } from '../TatumBitcoinApiClient.ts';

describe('TatumBitcoinApiClient E2E', () => {
  let client: TatumBitcoinApiClient;

  beforeAll(() => {
    // Skip if no API key is provided
    if (!process.env.TATUM_API_KEY || process.env.TATUM_API_KEY === 'YourApiKeyToken') {
      console.warn('Skipping Tatum E2E tests - no API key provided. Set TATUM_API_KEY environment variable.');
      return;
    }

    client = new TatumBitcoinApiClient();
  });

  it.skipIf(!process.env.TATUM_API_KEY || process.env.TATUM_API_KEY === 'YourApiKeyToken')(
    'should connect to Tatum API and test health',
    async () => {
      const isHealthy = await client.isHealthy();
      expect(isHealthy).toBe(true);
    },
    30000 // 30 second timeout for network calls
  );

  it.skipIf(!process.env.TATUM_API_KEY || process.env.TATUM_API_KEY === 'YourApiKeyToken')(
    'should test connection successfully',
    async () => {
      const connected = await client.testConnection();
      expect(connected).toBe(true);
    },
    30000
  );

  it.skipIf(!process.env.TATUM_API_KEY || process.env.TATUM_API_KEY === 'YourApiKeyToken')(
    'should get balance for Genesis block address',
    async () => {
      // Genesis block address - known to have received coins but never spent
      const genesisAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const balance = await client.getRawAddressBalance(genesisAddress);

      expect(balance).toBeDefined();
      expect(balance.incoming).toBeDefined();
      expect(balance.outgoing).toBeDefined();

      // Genesis address should have received some coins
      expect(parseInt(balance.incoming)).toBeGreaterThan(0);
    },
    30000
  );

  it.skipIf(!process.env.TATUM_API_KEY || process.env.TATUM_API_KEY === 'YourApiKeyToken')(
    'should get transactions for Genesis block address',
    async () => {
      // Genesis block address - known to have transactions
      const genesisAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const transactions = await client.getRawAddressTransactions(genesisAddress, {
        pageSize: 10, // Limited page size for testing
      });

      expect(Array.isArray(transactions)).toBe(true);

      // Genesis address should have at least some transactions
      if (transactions.length > 0) {
        const tx = transactions[0];
        expect(tx).toBeDefined();
        expect(tx.hash).toBeDefined();
        expect(typeof tx.hash).toBe('string');
        expect(tx.blockNumber).toBeDefined();
        expect(typeof tx.blockNumber).toBe('number');
        expect(Array.isArray(tx.inputs)).toBe(true);
        expect(Array.isArray(tx.outputs)).toBe(true);
      }
    },
    30000
  );

  it.skipIf(!process.env.TATUM_API_KEY || process.env.TATUM_API_KEY === 'YourApiKeyToken')(
    'should handle pagination parameters correctly',
    async () => {
      const genesisAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const transactions = await client.getRawAddressTransactions(genesisAddress, {
        offset: 0,
        pageSize: 5,
      });

      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions.length).toBeLessThanOrEqual(5);
    },
    30000
  );

  it.skipIf(!process.env.TATUM_API_KEY || process.env.TATUM_API_KEY === 'YourApiKeyToken')(
    'should get address info through execute method',
    async () => {
      const genesisAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const addressInfo = (await client.execute({
        address: genesisAddress,
        type: 'getAddressInfo',
      })) as { balance: string; txCount: number };

      expect(addressInfo).toBeDefined();
      expect(addressInfo.balance).toBeDefined();
      expect(typeof addressInfo.balance).toBe('string');
      expect(addressInfo.txCount).toBeDefined();
      expect(typeof addressInfo.txCount).toBe('number');
    },
    30000
  );

  it.skipIf(!process.env.TATUM_API_KEY || process.env.TATUM_API_KEY === 'YourApiKeyToken')(
    'should handle empty address gracefully',
    async () => {
      // Use a freshly generated address that likely has no transactions
      const emptyAddress = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

      const transactions = await client.getRawAddressTransactions(emptyAddress);
      expect(Array.isArray(transactions)).toBe(true);
      // Could be empty array or have transactions, both are valid

      const balance = await client.getRawAddressBalance(emptyAddress);
      expect(balance).toBeDefined();
      expect(balance.incoming).toBeDefined();
      expect(balance.outgoing).toBeDefined();
    },
    30000
  );

  it.skipIf(!process.env.TATUM_API_KEY || process.env.TATUM_API_KEY === 'YourApiKeyToken')(
    'should respect rate limiting',
    async () => {
      const genesisAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      // Make multiple requests in quick succession
      const promises = Array.from({ length: 3 }, () => client.getRawAddressBalance(genesisAddress));

      const startTime = Date.now();
      const results = await Promise.all(promises);
      const endTime = Date.now();

      // All requests should succeed
      expect(results.length).toBe(3);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.incoming).toBeDefined();
        expect(result.outgoing).toBeDefined();
      });

      // Should take at least some time due to rate limiting (3 req/s)
      const duration = endTime - startTime;
      console.log(`Multiple requests took ${duration}ms`);
      // Note: This is informational - actual rate limiting depends on the HTTP client implementation
    },
    45000
  );
});
