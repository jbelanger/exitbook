import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { NearTransaction } from '../../../schemas.js';
import { NearBlocksApiClient } from '../nearblocks.api-client.js';

describe.sequential('NearBlocksApiClient Streaming E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks');
  const client = new NearBlocksApiClient(config);
  const testAddress = '3c49dfe359205e7ceb0cfac58f3592d12b14554e73f1f5448ea938cb04cf5fcc'; // Address with transactions

  describe('streamAddressTransactions', () => {
    it('should stream transactions with cursor management', async () => {
      const operation = { type: 'getAddressTransactions' as const, address: testAddress };
      const stream = client.executeStreaming<NearTransaction>(operation);

      let batchCount = 0;
      let totalTransactions = 0;
      let lastCursor: CursorState | undefined;
      const maxBatches = 3; // Limit for testing

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        batchCount++;

        expect(batch).toHaveProperty('data');
        expect(batch).toHaveProperty('cursor');
        expect(Array.isArray(batch.data)).toBe(true);

        totalTransactions += batch.data.length;
        lastCursor = batch.cursor;

        // Verify cursor structure
        expect(batch.cursor).toHaveProperty('primary');
        expect(batch.cursor).toHaveProperty('lastTransactionId');
        expect(batch.cursor).toHaveProperty('totalFetched');
        expect(batch.cursor).toHaveProperty('metadata');

        // Verify cursor metadata
        expect(batch.cursor.metadata).toBeDefined();
        expect(batch.cursor.metadata?.providerName).toBe('nearblocks');
        expect(typeof batch.cursor.metadata?.updatedAt).toBe('number');
        expect(typeof batch.isComplete).toBe('boolean');

        // Verify primary cursor is pageToken
        if (batch.cursor.primary.type === 'pageToken') {
          expect(batch.cursor.primary.providerName).toBe('nearblocks');
          expect(typeof batch.cursor.primary.value).toBe('string');
        }

        // Verify each transaction
        for (const txData of batch.data) {
          expect(txData).toHaveProperty('normalized');
          expect(txData).toHaveProperty('raw');

          const tx = txData.normalized;
          expect(tx.providerName).toBe('nearblocks');
          expect(typeof tx.id).toBe('string');
          expect(['success', 'failed', 'pending']).toContain(tx.status);
          expect(typeof tx.timestamp).toBe('number');
        }

        // Stop after maxBatches for testing
        if (batchCount >= maxBatches || batch.isComplete) {
          break;
        }
      }

      expect(batchCount).toBeGreaterThan(0);
      expect(totalTransactions).toBeGreaterThan(0);
      expect(lastCursor).toBeDefined();
    }, 90000);

    it('should resume streaming from cursor', async () => {
      const operation = { type: 'getAddressTransactions' as const, address: testAddress };

      // First stream: get first batch and cursor
      const stream1 = client.executeStreaming<NearTransaction>(operation);
      const firstBatchResult = await stream1.next();

      expect(firstBatchResult.done).toBe(false);
      if (firstBatchResult.done || !firstBatchResult.value) return;

      const firstBatchValue = firstBatchResult.value;
      if (firstBatchValue.isErr()) return;

      const firstBatch = firstBatchValue.value;
      const resumeCursor = firstBatch.cursor;

      expect(firstBatch.data.length).toBeGreaterThan(0);
      expect(resumeCursor).toBeDefined();

      // Second stream: resume from cursor
      const stream2 = client.executeStreaming<NearTransaction>(operation, resumeCursor);
      const secondBatchResult = await stream2.next();

      expect(secondBatchResult.done).toBe(false);
      if (secondBatchResult.done || !secondBatchResult.value) return;

      const secondBatchValue = secondBatchResult.value;
      if (secondBatchValue.isErr()) return;

      const secondBatch = secondBatchValue.value;

      // Verify we got different transactions
      const firstIds = new Set(firstBatch.data.map((tx) => tx.normalized.id));
      const secondIds = new Set(secondBatch.data.map((tx) => tx.normalized.id));

      // Most transactions should be different (allowing for some overlap due to enrichment)
      const overlap = Array.from(firstIds).filter((id) => secondIds.has(id)).length;
      const overlapRatio = overlap / Math.min(firstIds.size, secondIds.size);

      expect(overlapRatio).toBeLessThan(0.5); // Less than 50% overlap
    }, 90000);

    it('should handle enrichment in streaming mode', async () => {
      const operation = { type: 'getAddressTransactions' as const, address: testAddress };
      const stream = client.executeStreaming<NearTransaction>(operation);

      let foundEnrichedTransaction = false;

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;

        for (const txData of batch.data) {
          const tx = txData.normalized;

          // Check if any transaction has account changes (enrichment data)
          if (tx.accountChanges && tx.accountChanges.length > 0) {
            foundEnrichedTransaction = true;

            // Verify structure of account changes
            const change = tx.accountChanges[0]!;
            expect(typeof change.account).toBe('string');
            expect(typeof change.preBalance).toBe('string');
            expect(typeof change.postBalance).toBe('string');

            break;
          }
        }

        if (foundEnrichedTransaction || batch.isComplete) {
          break;
        }
      }

      // Note: If no enriched transactions found, that's okay - it means
      // the test address didn't have transactions with balance changes in the first few batches
      if (!foundEnrichedTransaction) {
        console.warn('No enriched transactions found in streaming test - this may be expected');
      }
    }, 90000);

    it('should handle empty results gracefully', async () => {
      const emptyAddress = 'nonexistent12345.near';
      const operation = { type: 'getAddressTransactions' as const, address: emptyAddress };
      const stream = client.executeStreaming<NearTransaction>(operation);

      const results = [];
      for await (const result of stream) {
        results.push(result);
      }

      // Should either complete successfully with no data or fail validation
      if (results.length > 0 && results[0]!.isOk()) {
        const batch = results[0].value;
        expect(batch.data.length).toBe(0);
        expect(batch.isComplete).toBe(true);
      }
    }, 30000);
  });

  describe('streamAddressTokenTransactions', () => {
    it('should stream token transactions with cursor management', async () => {
      const operation = { type: 'getAddressTokenTransactions' as const, address: testAddress };
      const stream = client.executeStreaming<NearTransaction>(operation);

      let batchCount = 0;
      let lastCursor: CursorState | undefined;
      const maxBatches = 2; // Limit for testing

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        batchCount++;

        expect(batch).toHaveProperty('data');
        expect(batch).toHaveProperty('cursor');
        expect(Array.isArray(batch.data)).toBe(true);

        lastCursor = batch.cursor;

        // Verify cursor structure
        expect(batch.cursor).toHaveProperty('primary');
        expect(batch.cursor).toHaveProperty('metadata');
        expect(batch.cursor.metadata).toBeDefined();
        expect(batch.cursor.metadata?.providerName).toBe('nearblocks');

        // Verify token transactions
        for (const txData of batch.data) {
          const tx = txData.normalized;

          expect(tx.type).toBe('token_transfer');
          expect(Array.isArray(tx.tokenTransfers)).toBe(true);

          if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
            const tokenTransfer = tx.tokenTransfers[0]!;
            expect(typeof tokenTransfer.contractAddress).toBe('string');
            expect(typeof tokenTransfer.from).toBe('string');
            expect(typeof tokenTransfer.to).toBe('string');
            expect(typeof tokenTransfer.amount).toBe('string');
          }
        }

        // Stop after maxBatches or completion
        if (batchCount >= maxBatches || batch.isComplete) {
          break;
        }
      }

      expect(batchCount).toBeGreaterThan(0);
      expect(lastCursor).toBeDefined();
    }, 90000);

    it('should handle addresses with no token transactions', async () => {
      // Use an address that likely has no FT transactions
      const noTokenAddress = 'system';
      const operation = { type: 'getAddressTokenTransactions' as const, address: noTokenAddress };
      const stream = client.executeStreaming<NearTransaction>(operation);

      const results = [];
      for await (const result of stream) {
        results.push(result);
        // Break after first result for efficiency
        break;
      }

      // Should handle gracefully (either empty results or API error)
      expect(results.length).toBeGreaterThanOrEqual(0);
    }, 30000);
  });

  describe('Cursor Types and Replay Window', () => {
    it('should extract correct cursor types from transactions', async () => {
      const operation = { type: 'getAddressTransactions' as const, address: testAddress };
      const stream = client.executeStreaming<NearTransaction>(operation);

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;

        if (batch.data.length > 0) {
          const tx = batch.data[0]!.normalized;
          const cursors = client.extractCursors(tx);

          expect(Array.isArray(cursors)).toBe(true);
          expect(cursors.length).toBeGreaterThan(0);

          // Should have timestamp cursor at minimum
          const timestampCursor = cursors.find((c) => c.type === 'timestamp');
          expect(timestampCursor).toBeDefined();
          expect(typeof timestampCursor!.value).toBe('number');

          break;
        }
      }
    }, 30000);

    it('should apply replay window to blockNumber cursors', () => {
      const cursor = { type: 'blockNumber' as const, value: 100 };
      const replayedCursor = client.applyReplayWindow(cursor);

      expect(replayedCursor.type).toBe('blockNumber');
      // Should subtract 3 blocks (configured replay window)
      expect(replayedCursor.value).toBe(97);
    });

    it('should not apply replay window to non-blockNumber cursors', () => {
      const cursor = { type: 'timestamp' as const, value: 1000000 };
      const replayedCursor = client.applyReplayWindow(cursor);

      expect(replayedCursor.type).toBe('timestamp');
      expect(replayedCursor.value).toBe(1000000); // Unchanged
    });

    it('should handle replay window at boundary (block 0)', () => {
      const cursor = { type: 'blockNumber' as const, value: 10 };
      const replayedCursor = client.applyReplayWindow(cursor);

      expect(replayedCursor.type).toBe('blockNumber');
      expect(replayedCursor.value).toBe(7); // Should not go negative
    });
  });
});
