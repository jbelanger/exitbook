import type { RawTransactionMetadata } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/data';
import { beforeAll, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import { TatumBitcoinApiClient } from '../tatum-bitcoin.api-client.js';
import { TatumBitcoinTransactionMapper } from '../tatum.mapper.js';
import type { TatumBitcoinTransaction } from '../tatum.types.js';

describe('TatumBitcoinTransactionMapper E2E', () => {
  let mapper: TatumBitcoinTransactionMapper;
  // Reuse same client across tests to share rate limiter

  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'tatum');
  const client = new TatumBitcoinApiClient(config);

  beforeAll(() => {
    if (!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken') {
      console.warn('Skipping Tatum mapper E2E tests - no API key provided. Set TATUM_API_KEY environment variable.');
      return;
    }

    mapper = new TatumBitcoinTransactionMapper();
  });

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should map real transaction data from API',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address

      const rawTransactions = await client.execute<TatumBitcoinTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(rawTransactions.length).toBeGreaterThan(0);

      const rawTx = rawTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'tatum',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.id).toBe(rawTx.hash);
        expect(normalized.currency).toBe('BTC');
        expect(normalized.providerId).toBe('tatum');
        expect(normalized.status).toMatch(/success|pending/);
        expect(Array.isArray(normalized.inputs)).toBe(true);
        expect(Array.isArray(normalized.outputs)).toBe(true);
        expect(normalized.timestamp).toBeGreaterThan(0);
      }
    },
    45000
  );

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should handle confirmed transactions correctly',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const rawTransactions = await client.execute<TatumBitcoinTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      const confirmedTx = rawTransactions.find((tx) => tx.blockNumber);
      if (!confirmedTx) {
        console.warn('No confirmed transactions found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'tatum',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(confirmedTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.status).toBe('success');
        expect(normalized.blockHeight).toBeDefined();
        expect(normalized.blockId).toBeDefined();
      }
    },
    45000
  );

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should map transaction fees correctly',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const rawTransactions = await client.execute<TatumBitcoinTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      const txWithFee = rawTransactions.find((tx) => tx.fee > 0);
      if (!txWithFee) {
        console.warn('No transactions with fees found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'tatum',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(txWithFee, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;
        expect(normalized.feeAmount).toBeDefined();
        expect(normalized.feeCurrency).toBe('BTC');
        expect(parseFloat(normalized.feeAmount!)).toBeGreaterThan(0);
      }
    },
    45000
  );

  it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
    'should map inputs and outputs with addresses',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const rawTransactions = await client.execute<TatumBitcoinTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      const rawTx = rawTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'tatum',
      };
      const sessionContext: ImportSessionMetadata = {
        address: testAddress,
      };

      const result = mapper.map(rawTx, metadata, sessionContext);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const normalized = result.value;

        // Check inputs
        expect(normalized.inputs.length).toBe(rawTx.inputs.length);
        normalized.inputs.forEach((input) => {
          expect(input).toHaveProperty('txid');
          expect(input).toHaveProperty('value');
          expect(input).toHaveProperty('vout');
        });

        // Check outputs
        expect(normalized.outputs.length).toBe(rawTx.outputs.length);
        normalized.outputs.forEach((output, index) => {
          expect(output).toHaveProperty('value');
          expect(output.index).toBe(index);
        });
      }
    },
    45000
  );
});
