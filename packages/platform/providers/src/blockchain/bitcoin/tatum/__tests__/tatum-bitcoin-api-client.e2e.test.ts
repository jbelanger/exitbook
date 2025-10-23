import type { BlockchainBalanceSnapshot } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { TransactionWithRawData } from '../../../../shared/blockchain/index.ts';
import { ProviderRegistry } from '../../../../shared/blockchain/index.ts';
import type { BitcoinTransaction } from '../../types.ts';
import { TatumBitcoinApiClient } from '../tatum-bitcoin.api-client.ts';

describe('TatumBitcoinApiClient E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'tatum');
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
      const result = await provider.execute<BlockchainBalanceSnapshot>({
        address: testAddress,
        type: 'getAddressBalances',
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const balance = result.value;
        expect(balance).toBeDefined();
        expect(balance).toHaveProperty('total');
        expect(typeof balance.total).toBe('string');
      }
    },
    30000
  );

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should fetch normalized address transactions successfully',
    async () => {
      const result = await provider.execute<TransactionWithRawData<BitcoinTransaction>[]>({
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
          expect(tx).toHaveProperty('id');
          expect(tx).toHaveProperty('inputs');
          expect(tx).toHaveProperty('outputs');
          expect(tx).toHaveProperty('timestamp');
          expect(tx).toHaveProperty('currency');
          expect(tx).toHaveProperty('providerId');
          expect(tx.currency).toBe('BTC');
          expect(tx.providerId).toBe('tatum');
          expect(Array.isArray(tx.inputs)).toBe(true);
          expect(Array.isArray(tx.outputs)).toBe(true);
        }
      }
    },
    30000
  );

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should return true for address with transactions',
    async () => {
      const result = await provider.execute<boolean>({
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
      const result = await provider.execute<boolean>({
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
