import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../core/index.js';
import type { StreamingBatchResult } from '../../../../core/types/index.js';
import type { CardanoTransaction } from '../../schemas.js';
import { BlockfrostApiClient } from '../blockfrost-api-client.js';

/**
 * Blockfrost Streaming E2E Tests
 *
 * API CREDIT USAGE WARNING:
 * Blockfrost uses a 3-call pattern per transaction (hash + details + utxos).
 * With page size = 10 transactions, each batch = ~31 API calls.
 *
 * Estimated total API usage when all tests run:
 * - Basic streaming test: ~31 calls (1 batch)
 * - Cursor extraction test: ~31 calls (1 batch)
 * - Track totalFetched test: ~31 calls (1 batch)
 * - Resume + dedup test: ~62 calls (2 batches)
 * - Completion test: ~1 call (empty address)
 * - Error handling test: ~1 call (invalid address)
 * - UTXO structure test: ~31 calls (1 batch)
 * - Fee info test: ~31 calls (1 batch)
 * TOTAL: ~219 API calls for full test suite
 */
describe('BlockfrostApiClient Streaming E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('cardano', 'blockfrost');
  const provider = new BlockfrostApiClient(config);
  // Minswap DEX contract address - a well-known public address with many transactions
  const testAddress =
    'addr1z8snz7c4974vzdpxu65ruphl3zjdvtxw8strf2c2tmqnxz2j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq0xmsha';
  // Empty address for completion tests
  const emptyAddress =
    'addr1qyy6nhfyks7wdu3dudslys37v252w2nwhv0fw2nfawemmnqs6l44z7hzxnqh0m95pzf028czh9e2mzq2v25qw5hwxkfqggkx3l';

  describe('streamAddressTransactions via executeStreaming', () => {
    it.skipIf(!process.env['BLOCKFROST_API_KEY'])(
      'should stream transactions in batches with cursor state',
      async () => {
        // WARNING: Each transaction requires 3 API calls (hash + details + utxos)
        // Current page size is 10 txs = ~31 API calls per batch
        const batches: StreamingBatchResult<CardanoTransaction>[] = [];
        let batchCount = 0;
        const maxBatches = 1; // Only fetch 1 batch (~31 API calls)

        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
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
            expect(firstTx.normalized.providerName).toBe('blockfrost');
            expect(firstTx.normalized.currency).toBe('ADA');
            expect(typeof firstTx.normalized.blockHeight).toBe('number');
          }

          // Verify cursor state structure
          expect(batch.cursor).toHaveProperty('primary');
          expect(batch.cursor).toHaveProperty('alternatives');
          expect(batch.cursor).toHaveProperty('lastTransactionId');
          expect(batch.cursor).toHaveProperty('totalFetched');
          expect(batch.cursor).toHaveProperty('metadata');

          // Verify cursor metadata
          expect(batch.cursor.metadata?.providerName).toBe('blockfrost');
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

    it.skipIf(!process.env['BLOCKFROST_API_KEY'])(
      'should extract cursors with blockNumber and timestamp',
      async () => {
        // WARNING: ~31 API calls (1 batch)
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
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

          // Primary cursor should be pageToken for Blockfrost
          expect(cursor.primary.type).toBe('pageToken');
          if (cursor.primary.type === 'pageToken') {
            expect(cursor.primary.providerName).toBe('blockfrost');
            expect(typeof cursor.primary.value).toBe('string');
            // For page-based pagination, the value should be a numeric string
            expect(parseInt(cursor.primary.value, 10)).toBeGreaterThanOrEqual(1);
          }

          // Only need to verify first batch
          break;
        }
      },
      60000
    );

    it.skipIf(!process.env['BLOCKFROST_API_KEY'])(
      'should track totalFetched across batches',
      async () => {
        // WARNING: ~31 API calls per batch
        let previousTotal = 0;
        let batchCount = 0;
        const maxBatches = 1; // Only 1 batch (~31 API calls)

        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
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

    it.skipIf(!process.env['BLOCKFROST_API_KEY'])(
      'should resume from cursor state and handle deduplication',
      async () => {
        // WARNING: This test fetches 2 batches (~62 API calls total)
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        // Fetch first batch
        let firstBatchCursor: CursorState | undefined;
        let firstBatchLastTx: string | undefined;

        for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
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

        // Test 1: Resume from pageToken cursor
        let resumedBatchFirstTx: string | undefined;
        for await (const result of provider.executeStreaming<CardanoTransaction>(operation, firstBatchCursor)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            resumedBatchFirstTx = batch.data[0]!.normalized.id;

            // Test 2: Verify deduplication - last tx from first batch should not appear
            const hasLastTransaction = batch.data.some((tx) => tx.normalized.id === firstBatchLastTx);
            expect(hasLastTransaction).toBe(false);
            break;
          }
        }

        // Verify resume actually advanced
        expect(resumedBatchFirstTx).toBeDefined();
        expect(resumedBatchFirstTx).not.toBe(firstBatchLastTx);
      },
      60000
    );

    it.skip('Skipped: cross-provider resume test (expensive - would use ~62 API calls)', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
      };

      // Fetch first batch and get its cursor
      let firstBatchCursor: CursorState | undefined;
      const firstBatchLastId = new Set<string>();

      for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
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
      for await (const result of provider.executeStreaming<CardanoTransaction>(operation, crossProviderCursor)) {
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
      expect(hasLastTransaction).toBe(false);
    }, 60000);

    it.skipIf(!process.env['BLOCKFROST_API_KEY'])(
      'should mark isComplete when no more data available',
      async () => {
        // WARNING: ~1 API call (empty address returns 404 or empty list)
        const operation = {
          type: 'getAddressTransactions' as const,
          address: emptyAddress,
        };

        let lastBatch: StreamingBatchResult<CardanoTransaction> | undefined;
        let hadError = false;

        for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
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
    it.skipIf(!process.env['BLOCKFROST_API_KEY'])(
      'should extract blockNumber and timestamp cursors from transactions',
      async () => {
        // WARNING: ~31 API calls (1 batch)
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length === 0) continue;

          // All Cardano transactions should be confirmed (have blockHeight)
          const firstTx = batch.data[0]!;

          // Test cursor extraction
          const cursors = provider.extractCursors(firstTx.normalized);

          expect(Array.isArray(cursors)).toBe(true);
          expect(cursors.length).toBeGreaterThan(0);

          // Should extract blockNumber cursor
          const blockNumberCursor = cursors.find((c) => c.type === 'blockNumber');
          expect(blockNumberCursor).toBeDefined();
          if (blockNumberCursor && blockNumberCursor.type === 'blockNumber') {
            expect(typeof blockNumberCursor.value).toBe('number');
            expect(blockNumberCursor.value).toBe(firstTx.normalized.blockHeight);
          }

          // Should extract timestamp cursor
          const timestampCursor = cursors.find((c) => c.type === 'timestamp');
          expect(timestampCursor).toBeDefined();
          if (timestampCursor && timestampCursor.type === 'timestamp') {
            expect(typeof timestampCursor.value).toBe('number');
            expect(timestampCursor.value).toBe(firstTx.normalized.timestamp);
          }

          break;
        }
      },
      60000
    );

    it('should apply replay window to blockNumber cursor', () => {
      const blockNumberCursor = { type: 'blockNumber' as const, value: 10000000 };
      const adjustedCursor = provider.applyReplayWindow(blockNumberCursor);

      expect(adjustedCursor.type).toBe('blockNumber');
      if (adjustedCursor.type === 'blockNumber') {
        // Replay window is 2 blocks for Blockfrost
        expect(adjustedCursor.value).toBe(10000000 - 2);
      }
    });

    it('should not apply replay window to pageToken cursor', () => {
      const pageTokenCursor = {
        type: 'pageToken' as const,
        value: '2',
        providerName: 'blockfrost',
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
    // Deduplication is already tested in "should resume from cursor state and handle deduplication"
    // Skipping additional deduplication tests to conserve API credits
    it.skip('Skipped: deduplication tested in resume test (saves ~31 API calls)', () => {
      // Intentionally empty - test is skipped
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

    it.skipIf(!process.env['BLOCKFROST_API_KEY'])(
      'should handle API errors gracefully in streaming',
      async () => {
        // WARNING: ~1 API call (invalid address returns error)
        const invalidAddress = 'invalid-cardano-address';

        const operation = {
          type: 'getAddressTransactions' as const,
          address: invalidAddress,
        };

        for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
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

  describe('Cardano-specific streaming', () => {
    it.skipIf(!process.env['BLOCKFROST_API_KEY'])(
      'should stream Cardano transactions with UTXO structure',
      async () => {
        // WARNING: ~31 API calls (1 batch)
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!.normalized;

            // Cardano transactions have inputs and outputs (UTXO model)
            expect(firstTx).toHaveProperty('inputs');
            expect(firstTx).toHaveProperty('outputs');
            expect(Array.isArray(firstTx.inputs)).toBe(true);
            expect(Array.isArray(firstTx.outputs)).toBe(true);
            expect(firstTx.inputs.length).toBeGreaterThan(0);
            expect(firstTx.outputs.length).toBeGreaterThan(0);

            // Verify input structure
            const firstInput = firstTx.inputs[0]!;
            expect(firstInput).toHaveProperty('address');
            expect(firstInput).toHaveProperty('amounts');
            expect(firstInput).toHaveProperty('txHash');
            expect(firstInput).toHaveProperty('outputIndex');
            expect(Array.isArray(firstInput.amounts)).toBe(true);
            expect(firstInput.amounts.length).toBeGreaterThan(0);

            // Verify output structure
            const firstOutput = firstTx.outputs[0]!;
            expect(firstOutput).toHaveProperty('address');
            expect(firstOutput).toHaveProperty('amounts');
            expect(firstOutput).toHaveProperty('outputIndex');
            expect(Array.isArray(firstOutput.amounts)).toBe(true);
            expect(firstOutput.amounts.length).toBeGreaterThan(0);

            // Cardano currency
            expect(firstTx.currency).toBe('ADA');

            // Verify lovelace amount
            const hasLovelace = firstInput.amounts.some((amt) => amt.unit === 'lovelace');
            expect(hasLovelace).toBe(true);
          }
          break; // Only need first batch
        }
      },
      60000
    );

    it.skipIf(!process.env['BLOCKFROST_API_KEY'])(
      'should include fee information',
      async () => {
        // WARNING: ~31 API calls (1 batch)
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<CardanoTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!.normalized;

            // Cardano transactions should have fee information
            expect(firstTx.feeAmount).toBeDefined();
            expect(typeof firstTx.feeAmount).toBe('string');
            expect(firstTx.feeCurrency).toBe('ADA');

            if (firstTx.feeAmount) {
              const feeValue = parseFloat(firstTx.feeAmount);
              expect(feeValue).toBeGreaterThan(0);
            }
          }
          break; // Only need first batch
        }
      },
      60000
    );
  });
});
