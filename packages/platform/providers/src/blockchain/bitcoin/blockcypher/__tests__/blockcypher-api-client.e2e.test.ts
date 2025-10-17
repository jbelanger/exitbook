import { describe, expect, it } from 'vitest';

import type { TransactionWithRawData } from '../../../../core/blockchain/index.ts';
import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import type { AddressInfo, BitcoinTransaction } from '../../types.js';
import { BlockCypherApiClient } from '../blockcypher.api-client.js';

describe.skip('BlockCypherApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'blockcypher');
  const client = new BlockCypherApiClient(config);
  const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address
  const emptyAddress = 'bc1qeppvcnauqak9xn7mmekw4crr79tl9c8lnxpp2k'; // Address with no transactions

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
      const result = await client.execute<AddressInfo>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const addressInfo = result.value;
        expect(addressInfo).toBeDefined();
        expect(addressInfo).toHaveProperty('balance');
        expect(addressInfo).toHaveProperty('txCount');
        expect(typeof addressInfo.balance).toBe('string');
        expect(typeof addressInfo.txCount).toBe('number');
        expect(addressInfo.txCount).toBeGreaterThan(0);
      }
    },
    60000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should get normalized address transactions',
    async () => {
      const result = await client.execute<TransactionWithRawData<BitcoinTransaction>[]>({
        address: testAddress,
        type: 'getAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        expect(Array.isArray(transactions)).toBe(true);
        if (transactions.length > 0) {
          const txWithRaw = transactions[0]!;
          expect(txWithRaw).toHaveProperty('raw');
          expect(txWithRaw).toHaveProperty('normalized');

          expect(txWithRaw.raw).toHaveProperty('hash');
          expect(txWithRaw.raw).toHaveProperty('inputs');
          expect(txWithRaw.raw).toHaveProperty('outputs');

          const tx = txWithRaw.normalized;
          expect(tx).toBeDefined();
          expect(tx.id).toBeDefined();
          expect(typeof tx.id).toBe('string');
          expect(tx.currency).toBe('BTC');
          expect(tx.providerId).toBe('blockcypher');
          expect(Array.isArray(tx.inputs)).toBe(true);
          expect(Array.isArray(tx.outputs)).toBe(true);
        }
      }
    },
    90000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should return true for address with transactions',
    async () => {
      const result = await client.execute<boolean>({
        address: testAddress,
        type: 'hasAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(true);
      }
    },
    60000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should return false for address without transactions',
    async () => {
      const result = await client.execute<boolean>({
        address: emptyAddress,
        type: 'hasAddressTransactions',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(false);
      }
    },
    60000
  );
});
