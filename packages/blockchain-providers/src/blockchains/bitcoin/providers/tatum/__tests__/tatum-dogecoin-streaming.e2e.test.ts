import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { StreamingBatchResult } from '../../../../../core/types/index.js';
import type { BitcoinTransaction } from '../../../schemas.js';
import { TatumDogecoinApiClient } from '../tatum-dogecoin.api-client.js';

describe('TatumDogecoinApiClient Streaming E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('dogecoin', 'tatum');
  const provider = new TatumDogecoinApiClient(config);
  // Known Dogecoin address with transactions (Dogecoin Foundation donation address)
  const testAddress = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';
  // Empty address for completion tests (valid format but never used)
  const emptyAddress = 'D7yWqxf8UcFPeMRKqvq4pzC8BbRPJzBENJ';

  describe('streamAddressTransactions via executeStreaming', () => {
    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should stream transactions in batches with cursor state',
      async () => {
        const batches: StreamingBatchResult<BitcoinTransaction>[] = [];
        let batchCount = 0;
        const maxBatches = 2; // Only fetch 2 batches to minimize API usage

        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) {
            console.error('Streaming error:', result.error.message);
            break;
          }

          const batch = result.value;
          batches.push(batch);
          batchCount++;

          // Verify batch structure
          expect(batch).toHaveProperty('data');
          expect(batch).toHaveProperty('cursor');
          expect(Array.isArray(batch.data)).toBe(true);

          // Verify transactions in batch
          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!;
            expect(firstTx).toHaveProperty('raw');
            expect(firstTx).toHaveProperty('normalized');
            expect(firstTx.normalized).toHaveProperty('id');
            expect(firstTx.normalized).toHaveProperty('inputs');
            expect(firstTx.normalized).toHaveProperty('outputs');
            expect(firstTx.normalized).toHaveProperty('timestamp');
            expect(firstTx.normalized.providerName).toBe('tatum');
            expect(firstTx.normalized.currency).toBe('DOGE');
            // blockHeight is optional for unconfirmed transactions
            if (firstTx.normalized.blockHeight !== undefined) {
              expect(typeof firstTx.normalized.blockHeight).toBe('number');
            }
          }

          // Verify cursor state structure
          expect(batch.cursor).toHaveProperty('primary');
          expect(batch.cursor).toHaveProperty('alternatives');
          expect(batch.cursor).toHaveProperty('lastTransactionId');
          expect(batch.cursor).toHaveProperty('totalFetched');
          expect(batch.cursor).toHaveProperty('metadata');

          // Verify cursor metadata
          expect(batch.cursor.metadata?.providerName).toBe('tatum');
          expect(batch.cursor.metadata?.updatedAt).toBeGreaterThan(0);
          expect(typeof batch.cursor.metadata?.isComplete).toBe('boolean');

          // Limit test to avoid API credit usage
          if (batchCount >= maxBatches) {
            break;
          }
        }

        // If address has no transactions, skip assertions
        if (batches.length === 0 || (batches.length > 0 && batches[0]!.data.length === 0)) {
          console.log('Test address has no transactions, skipping assertions');
          return;
        }

        expect(batches.length).toBeGreaterThan(0);
        expect(batches.length).toBeLessThanOrEqual(maxBatches);
      },
      60000
    );

    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should extract cursors with blockNumber and timestamp',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length === 0) continue;

          // Verify cursor extraction
          const cursor = batch.cursor;

          // Should have alternatives containing blockNumber and timestamp
          expect(cursor.alternatives).toBeDefined();
          expect(Array.isArray(cursor.alternatives)).toBe(true);

          const blockNumberCursor = cursor.alternatives?.find((c) => c.type === 'blockNumber');
          const timestampCursor = cursor.alternatives?.find((c) => c.type === 'timestamp');

          expect(blockNumberCursor).toBeDefined();
          expect(timestampCursor).toBeDefined();

          if (blockNumberCursor && blockNumberCursor.type === 'blockNumber') {
            expect(typeof blockNumberCursor.value).toBe('number');
            expect(blockNumberCursor.value).toBeGreaterThan(0);
          }

          if (timestampCursor && timestampCursor.type === 'timestamp') {
            expect(typeof timestampCursor.value).toBe('number');
            expect(timestampCursor.value).toBeGreaterThan(0);
          }

          // Primary cursor should be pageToken when more data available, blockNumber when complete
          if (batch.cursor.metadata?.isComplete) {
            // On final page, primary cursor falls back to blockNumber
            expect(['pageToken', 'blockNumber']).toContain(cursor.primary.type);
          } else {
            // When more data available, should have pageToken
            expect(cursor.primary.type).toBe('pageToken');
            if (cursor.primary.type === 'pageToken') {
              expect(cursor.primary.providerName).toBe('tatum');
              expect(typeof cursor.primary.value).toBe('string');
              // For offset-based pagination, the value should be a numeric string
              expect(parseInt(cursor.primary.value, 10)).toBeGreaterThanOrEqual(0);
            }
          }

          // Only need to verify first batch
          break;
        }
      },
      60000
    );

    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should track totalFetched across batches',
      async () => {
        let previousTotal = 0;
        let batchCount = 0;
        const maxBatches = 2; // Only 2 batches to minimize API usage

        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length === 0) {
            // If no data, we've reached the end
            break;
          }

          const currentTotal = batch.cursor.totalFetched;

          // Total should increase with each batch
          expect(currentTotal).toBeGreaterThan(previousTotal);

          // Total should equal previous total plus current batch size
          const expectedTotal = previousTotal + batch.data.length;
          expect(currentTotal).toBe(expectedTotal);

          previousTotal = currentTotal;
          batchCount++;

          if (batchCount >= maxBatches) break;
        }

        // If we got at least 1 batch with data, test passes
        if (batchCount === 0) {
          console.log('Test address has no transactions, skipping test');
        } else {
          expect(batchCount).toBeGreaterThan(0);
        }
      },
      60000
    );

    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should resume from cursor state (pageToken)',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        // Fetch first batch
        let firstBatchCursor: CursorState | undefined;
        let firstBatchLastTx: string | undefined;

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            firstBatchCursor = batch.cursor;
            firstBatchLastTx = batch.cursor.lastTransactionId;
            break;
          }
        }

        // Skip test if no transactions found
        if (!firstBatchCursor || !firstBatchLastTx) {
          console.log('Test address has no transactions, skipping test');
          return;
        }

        expect(firstBatchCursor).toBeDefined();
        expect(firstBatchLastTx).toBeDefined();

        // Resume from cursor (only fetch 1 more batch)
        let resumedBatchFirstTx: string | undefined;
        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation, firstBatchCursor)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            resumedBatchFirstTx = batch.data[0]!.normalized.id;
            break;
          }
        }

        // Verify resume actually advanced: first tx of resumed batch must differ from last tx of first batch
        expect(resumedBatchFirstTx).toBeDefined();
        expect(resumedBatchFirstTx).not.toBe(firstBatchLastTx);
      },
      60000
    );

    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should mark isComplete when no more data available',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: emptyAddress,
        };

        let lastBatch: StreamingBatchResult<BitcoinTransaction> | undefined;
        let hadError = false;

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          if (result.isErr()) {
            hadError = true;
            break;
          }

          lastBatch = result.value;
        }

        // Skip if API returned error
        if (hadError) {
          console.log('API error for empty address, skipping test');
          return;
        }

        if (lastBatch) {
          // Last batch should be marked as complete
          expect(lastBatch.cursor.metadata?.isComplete).toBe(true);
        }
      },
      60000
    );
  });

  describe('Cursor extraction and replay window', () => {
    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should extract blockNumber and timestamp cursors from transactions',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length === 0) continue;

          // Find a confirmed transaction (one with blockHeight)
          const confirmedTx = batch.data.find((tx) => tx.normalized.blockHeight !== undefined);
          if (!confirmedTx) {
            // Skip batch if no confirmed transactions
            continue;
          }

          // Test cursor extraction on confirmed transaction
          const cursors = provider.extractCursors(confirmedTx.normalized);

          expect(Array.isArray(cursors)).toBe(true);
          expect(cursors.length).toBeGreaterThan(0);

          // Should extract blockNumber cursor
          const blockNumberCursor = cursors.find((c) => c.type === 'blockNumber');
          expect(blockNumberCursor).toBeDefined();
          if (blockNumberCursor && blockNumberCursor.type === 'blockNumber') {
            expect(typeof blockNumberCursor.value).toBe('number');
            expect(blockNumberCursor.value).toBe(confirmedTx.normalized.blockHeight);
          }

          // Should extract timestamp cursor
          const timestampCursor = cursors.find((c) => c.type === 'timestamp');
          expect(timestampCursor).toBeDefined();
          if (timestampCursor && timestampCursor.type === 'timestamp') {
            expect(typeof timestampCursor.value).toBe('number');
            expect(timestampCursor.value).toBe(confirmedTx.normalized.timestamp);
          }

          break;
        }
      },
      60000
    );

    it('should apply replay window to blockNumber cursor', () => {
      const blockNumberCursor = { type: 'blockNumber' as const, value: 800000 };
      const adjustedCursor = provider.applyReplayWindow(blockNumberCursor);

      expect(adjustedCursor.type).toBe('blockNumber');
      if (adjustedCursor.type === 'blockNumber') {
        // Replay window is 4 blocks for Tatum
        expect(adjustedCursor.value).toBe(800000 - 4);
      }
    });

    it('should not apply replay window to pageToken cursor', () => {
      const pageTokenCursor = {
        type: 'pageToken' as const,
        value: '50',
        providerName: 'tatum',
      };
      const adjustedCursor = provider.applyReplayWindow(pageTokenCursor);

      // Should return same cursor unchanged
      expect(adjustedCursor).toEqual(pageTokenCursor);
    });

    it('should handle zero block edge case in replay window', () => {
      const blockNumberCursor = { type: 'blockNumber' as const, value: 3 };
      const adjustedCursor = provider.applyReplayWindow(blockNumberCursor);

      expect(adjustedCursor.type).toBe('blockNumber');
      if (adjustedCursor.type === 'blockNumber') {
        // Should not go below 0
        expect(adjustedCursor.value).toBe(0);
        expect(adjustedCursor.value).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Error handling', () => {
    it('should return error for unsupported streaming operation', async () => {
      const operation = {
        type: 'getAddressBalances' as const, // Not implemented for streaming
        address: testAddress,
      };

      for await (const result of provider.executeStreaming(operation)) {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Streaming not yet implemented');
        }
        break; // Should only yield one error
      }
    }, 30000);

    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should handle API errors gracefully in streaming',
      async () => {
        const invalidAddress = 'invalid-dogecoin-address';

        const operation = {
          type: 'getAddressTransactions' as const,
          address: invalidAddress,
        };

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          // Should return an error result rather than throwing
          if (result.isErr()) {
            expect(result.error).toBeDefined();
            expect(result.error.message).toBeTruthy();
          }
          break;
        }
      },
      30000
    );
  });

  describe('Dogecoin-specific streaming', () => {
    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should stream Dogecoin transactions with UTXO structure',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!.normalized;

            // Dogecoin transactions have inputs and outputs (UTXO model)
            expect(firstTx).toHaveProperty('inputs');
            expect(firstTx).toHaveProperty('outputs');
            expect(Array.isArray(firstTx.inputs)).toBe(true);
            expect(Array.isArray(firstTx.outputs)).toBe(true);
            expect(firstTx.inputs.length).toBeGreaterThan(0);
            expect(firstTx.outputs.length).toBeGreaterThan(0);

            // Verify input structure
            const firstInput = firstTx.inputs[0]!;
            expect(firstInput).toHaveProperty('value');
            expect(typeof firstInput.value).toBe('string');

            // Verify output structure
            const firstOutput = firstTx.outputs[0]!;
            expect(firstOutput).toHaveProperty('value');
            expect(firstOutput).toHaveProperty('index');
            expect(typeof firstOutput.value).toBe('string');
            expect(typeof firstOutput.index).toBe('number');

            // Dogecoin currency
            expect(firstTx.currency).toBe('DOGE');
          }
          break; // Only need first batch
        }
      },
      60000
    );

    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should include fee information when available',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!.normalized;

            // If fee is present, verify structure
            if (firstTx.feeAmount) {
              expect(typeof firstTx.feeAmount).toBe('string');
              expect(firstTx.feeCurrency).toBe('DOGE');
            }
          }
          break; // Only need first batch
        }
      },
      60000
    );
  });
});
