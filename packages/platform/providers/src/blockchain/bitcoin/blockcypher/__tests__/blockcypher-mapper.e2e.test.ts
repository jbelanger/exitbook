import type { RawTransactionMetadata } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/data';
import { beforeAll, describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/blockchain/index.ts';
import { BlockCypherApiClient } from '../blockcypher.api-client.js';
import { BlockCypherTransactionMapper } from '../blockcypher.mapper.js';
import type { BlockCypherTransaction } from '../blockcypher.types.js';

describe.skip('BlockCypherTransactionMapper E2E', () => {
  let mapper: BlockCypherTransactionMapper;
  // Reuse same client across tests to share rate limiter
  const config = ProviderRegistry.createDefaultConfig('bitcoin', 'blockcypher');
  const client = new BlockCypherApiClient(config);

  beforeAll(() => {
    if (!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken') {
      console.warn(
        'Skipping BlockCypher mapper E2E tests - no API key provided. Set BLOCKCYPHER_API_KEY environment variable.'
      );
      return;
    }

    mapper = new BlockCypherTransactionMapper();
  });

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should map real transaction data from API',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'; // Genesis block address

      const txResult = await client.execute<BlockCypherTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(txResult.isOk()).toBe(true);
      if (txResult.isErr()) return;

      const rawTransactions = txResult.value;
      expect(rawTransactions.length).toBeGreaterThan(0);

      const rawTx = rawTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'blockcypher',
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
        expect(normalized.providerId).toBe('blockcypher');
        expect(normalized.status).toMatch(/success|pending/);
        expect(Array.isArray(normalized.inputs)).toBe(true);
        expect(Array.isArray(normalized.outputs)).toBe(true);
        expect(normalized.timestamp).toBeGreaterThan(0);
      }
    },
    45000
  );

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should handle confirmed transactions correctly',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const txResult = await client.execute<BlockCypherTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(txResult.isOk()).toBe(true);
      if (txResult.isErr()) return;

      const rawTransactions = txResult.value;
      const confirmedTx = rawTransactions.find((tx) => tx.confirmations > 0);
      if (!confirmedTx) {
        console.warn('No confirmed transactions found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'blockcypher',
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

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should map transaction fees correctly',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const txResult = await client.execute<BlockCypherTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(txResult.isOk()).toBe(true);
      if (txResult.isErr()) return;

      const rawTransactions = txResult.value;
      const txWithFee = rawTransactions.find((tx) => tx.fees > 0);
      if (!txWithFee) {
        console.warn('No transactions with fees found, skipping test');
        return;
      }

      const metadata: RawTransactionMetadata = {
        providerId: 'blockcypher',
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

  it.skipIf(!process.env['BLOCKCYPHER_API_KEY'] || process.env['BLOCKCYPHER_API_KEY'] === 'YourApiKeyToken')(
    'should map inputs and outputs with addresses',
    async () => {
      const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      const txResult = await client.execute<BlockCypherTransaction[]>({
        address: testAddress,
        type: 'getRawAddressTransactions',
      });

      expect(txResult.isOk()).toBe(true);
      if (txResult.isErr()) return;

      const rawTransactions = txResult.value;
      const rawTx = rawTransactions[0]!;
      const metadata: RawTransactionMetadata = {
        providerId: 'blockcypher',
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
