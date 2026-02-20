import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { StreamingBatchResult, StreamingOperation } from '../../../../../core/types/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import type { BitcoinTransaction } from '../../../schemas.js';
import { TatumBitcoinApiClient } from '../tatum-bitcoin.api-client.js';

const providerRegistry = createProviderRegistry();

describe('TatumBitcoinApiClient Streaming E2E', () => {
  const config = providerRegistry.createDefaultConfig('bitcoin', 'tatum');
  const provider = new TatumBitcoinApiClient(config);
  // Genesis block address - known to have transactions
  const testAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
  // Empty address for completion tests
  const emptyAddress = 'bc1qeppvcnauqak9xn7mmekw4crr79tl9c8lnxpp2k';

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
          streamType: 'normal' as const,
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
            expect(firstTx.normalized.currency).toBe('BTC');
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
          expect(typeof batch.isComplete).toBe('boolean');

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
          streamType: 'normal' as const,
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

          // Primary cursor should be pageToken for Tatum
          expect(cursor.primary.type).toBe('pageToken');
          if (cursor.primary.type === 'pageToken') {
            expect(cursor.primary.providerName).toBe('tatum');
            expect(typeof cursor.primary.value).toBe('string');
            // For offset-based pagination, the value should be a numeric string
            expect(parseInt(cursor.primary.value, 10)).toBeGreaterThanOrEqual(0);
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
          streamType: 'normal' as const,
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
          streamType: 'normal' as const,
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
      'should handle deduplication during cross-provider resume',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
          streamType: 'normal' as const,
        };

        // Fetch first batch and get its cursor
        let firstBatchCursor: CursorState | undefined;
        const firstBatchLastId = new Set<string>();

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            // Store only the last transaction ID (what's in the cursor)
            firstBatchLastId.add(batch.cursor.lastTransactionId);
            firstBatchCursor = batch.cursor;
            break;
          }
        }

        // Skip test if no transactions found
        if (!firstBatchCursor || !firstBatchCursor.lastTransactionId) {
          console.log('Test address has no transactions, skipping test');
          return;
        }

        expect(firstBatchCursor).toBeDefined();
        expect(firstBatchCursor.lastTransactionId).toBeDefined();

        // Create a cross-provider cursor (simulating failover from blockNumber)
        const blockCursor = firstBatchCursor.alternatives?.find((c) => c.type === 'blockNumber');
        if (!blockCursor) {
          console.log('No blockNumber cursor available, skipping test');
          return;
        }

        const crossProviderCursor: CursorState = {
          primary: blockCursor,
          alternatives: firstBatchCursor.alternatives || [],
          lastTransactionId: firstBatchCursor.lastTransactionId,
          totalFetched: firstBatchCursor.totalFetched,
          metadata: {
            providerName: 'different-provider', // Simulate different provider
            updatedAt: Date.now(),
            isComplete: false,
          },
        };

        // Resume with cross-provider cursor
        let hasLastTransaction = false;
        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation, crossProviderCursor)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            // The dedup window should at least filter out the lastTransactionId
            for (const tx of batch.data) {
              if (tx.normalized.id === firstBatchCursor.lastTransactionId) {
                hasLastTransaction = true;
                break;
              }
            }
            break;
          }
        }

        // At minimum, the last transaction from the previous batch should be filtered
        // Note: Due to Tatum's offset-based pagination, other overlapping transactions
        // may appear when doing cross-provider resume with blockNumber cursor
        expect(hasLastTransaction).toBe(false);
      },
      60000
    );

    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should mark isComplete when no more data available',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: emptyAddress,
          streamType: 'normal' as const,
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
          expect(lastBatch.isComplete).toBe(true);
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
          streamType: 'normal' as const,
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

  describe('Deduplication behavior', () => {
    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should deduplicate transactions across batches during replay',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
          streamType: 'normal' as const,
        };

        // Fetch first batch
        let firstBatchCursor: CursorState | undefined;
        let lastTxId: string | undefined;

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            lastTxId = batch.cursor.lastTransactionId;
            firstBatchCursor = batch.cursor;
            break;
          }
        }

        // Skip if no transactions
        if (!firstBatchCursor || !lastTxId) {
          console.log('Test address has no transactions, skipping test');
          return;
        }

        expect(firstBatchCursor).toBeDefined();
        expect(lastTxId).toBeDefined();

        // Simulate cross-provider resume with replay window
        const blockCursor = firstBatchCursor.alternatives?.find((c) => c.type === 'blockNumber');
        if (!blockCursor || blockCursor.type !== 'blockNumber') {
          console.log('No blockNumber cursor available, skipping test');
          return;
        }

        const crossProviderCursor: CursorState = {
          primary: blockCursor,
          alternatives: firstBatchCursor.alternatives || [],
          lastTransactionId: lastTxId,
          totalFetched: 0, // Reset for cross-provider
          metadata: {
            providerName: 'blockstream', // Different provider to trigger replay
            updatedAt: Date.now(),
            isComplete: false,
          },
        };

        // Resume with cross-provider cursor - should apply replay window and deduplicate
        let hasLastTransaction = false;
        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation, crossProviderCursor)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            // Check if the lastTransactionId from first batch appears in second batch
            for (const tx of batch.data) {
              if (tx.normalized.id === lastTxId) {
                hasLastTransaction = true;
                break;
              }
            }
            break;
          }
        }

        // At minimum, the last transaction should be deduped
        // Note: Tatum's offset-based pagination means other transactions may overlap
        // during cross-provider resume, but the lastTransactionId should always be filtered
        expect(hasLastTransaction).toBe(false);
      },
      60000
    );

    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should not yield empty batches after deduplication',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
          streamType: 'normal' as const,
        };

        let batchCount = 0;
        const maxBatches = 1; // Only 1 batch to minimize API usage

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;

          // Every yielded batch should have data
          // (empty batches after deduplication should not be yielded)
          if (batch.data.length === 0) {
            // Only the last batch (when complete) is allowed to be empty
            expect(batch.isComplete).toBe(true);
          }

          batchCount++;
          if (batchCount >= maxBatches) break;
        }

        // If no transactions, skip
        if (batchCount === 0) {
          console.log('Test address has no transactions, skipping test');
        } else {
          expect(batchCount).toBeGreaterThan(0);
        }
      },
      60000
    );
  });

  describe('Error handling', () => {
    it('should return error for unsupported streaming operation', async () => {
      const operation = {
        type: 'getAddressBalances' as const, // Not implemented for streaming
        address: testAddress,
      };

      for await (const result of provider.executeStreaming(operation as unknown as StreamingOperation)) {
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
        const invalidAddress = 'invalid-bitcoin-address';

        const operation = {
          type: 'getAddressTransactions' as const,
          address: invalidAddress,
          streamType: 'normal' as const,
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

  describe('Bitcoin-specific streaming', () => {
    it.skipIf(!process.env['TATUM_API_KEY'] || process.env['TATUM_API_KEY'] === 'YourApiKeyToken')(
      'should stream Bitcoin transactions with UTXO structure',
      async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
          streamType: 'normal' as const,
        };

        for await (const result of provider.executeStreaming<BitcoinTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!.normalized;

            // Bitcoin transactions have inputs and outputs (UTXO model)
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

            // Bitcoin currency
            expect(firstTx.currency).toBe('BTC');
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
          streamType: 'normal' as const,
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
              expect(firstTx.feeCurrency).toBe('BTC');
            }
          }
          break; // Only need first batch
        }
      },
      60000
    );
  });
});
