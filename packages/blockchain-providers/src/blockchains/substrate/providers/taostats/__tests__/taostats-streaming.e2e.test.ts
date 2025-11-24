import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { SubstrateTransaction } from '../../../types.js';
import { TaostatsApiClient } from '../taostats.api-client.js';

describe.sequential('TaostatsApiClient Streaming E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('bittensor', 'taostats');
  const client = new TaostatsApiClient(config);
  // Test address with minimal transaction history to avoid rate limits
  const testAddress = '5HEo565WAy4Dbq3Sv271SAi7syBSofyfhhwRNjFNSM2gP9M2';

  /**
   * LIMITATION: These are live API tests that require a valid TAOSTATS_API_KEY.
   * To run them, ensure you have a valid TAOSTATS_API_KEY in your environment.
   */
  describe('streamAddressTransactions', () => {
    it('should stream transactions with cursor management', async () => {
      const operation = { type: 'getAddressTransactions' as const, address: testAddress };
      const stream = client.executeStreaming<SubstrateTransaction>(operation);

      let batchCount = 0;
      let totalTransactions = 0;
      let lastCursor: CursorState | undefined;
      const maxBatches = 3; // Limit for testing

      for await (const result of stream) {
        if (result.isErr()) {
          console.error('Streaming error:', result.error);
        }
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
        expect(batch.cursor.metadata?.providerName).toBe('taostats');
        expect(typeof batch.cursor.metadata?.updatedAt).toBe('number');
        expect(typeof batch.cursor.metadata?.isComplete).toBe('boolean');

        // Verify primary cursor is blockNumber
        if (batch.cursor.primary.type === 'blockNumber') {
          expect(typeof batch.cursor.primary.value).toBe('number');
        }

        // Verify each transaction
        for (const txData of batch.data) {
          expect(txData).toHaveProperty('normalized');
          expect(txData).toHaveProperty('raw');

          const tx = txData.normalized;
          expect(tx.providerName).toBe('taostats');
          expect(typeof tx.id).toBe('string');
          expect(['success', 'failed', 'pending']).toContain(tx.status);
          expect(typeof tx.timestamp).toBe('number');
          expect(tx.currency).toBe('TAO');
        }

        // Stop after maxBatches for testing
        if (batchCount >= maxBatches || batch.cursor.metadata?.isComplete) {
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
      const stream1 = client.executeStreaming<SubstrateTransaction>(operation);
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
      const stream2 = client.executeStreaming<SubstrateTransaction>(operation, resumeCursor);
      const secondBatchResult = await stream2.next();

      expect(secondBatchResult.done).toBe(false);
      if (secondBatchResult.done || !secondBatchResult.value) return;

      const secondBatchValue = secondBatchResult.value;
      if (secondBatchValue.isErr()) return;

      const secondBatch = secondBatchValue.value;

      // Verify the stream is progressing
      expect(secondBatch.data.length).toBeGreaterThan(0);

      // Verify cursor is advancing
      expect(secondBatch.cursor.totalFetched).toBeGreaterThan(firstBatch.cursor.totalFetched);

      // With offset-based pagination and deduplication, verify we're making progress
      // The streaming adapter maintains a dedup window, so some overlap is expected
      const firstIds = new Set(firstBatch.data.map((tx) => tx.normalized.id));
      const secondIds = new Set(secondBatch.data.map((tx) => tx.normalized.id));

      // Check that we're getting some new transactions
      const uniqueInSecond = Array.from(secondIds).filter((id) => !firstIds.has(id)).length;

      // Should have at least some unique transactions in second batch (unless stream is complete)
      if (!secondBatch.cursor.metadata?.isComplete) {
        expect(uniqueInSecond).toBeGreaterThan(0);
      }
    }, 90000);

    it('should handle empty results gracefully', async () => {
      // Random address that should have no transactions
      const emptyAddress = '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM';
      const operation = { type: 'getAddressTransactions' as const, address: emptyAddress };
      const stream = client.executeStreaming<SubstrateTransaction>(operation);

      const results = [];
      for await (const result of stream) {
        results.push(result);
      }

      // Should complete successfully with no data
      if (results.length > 0 && results[0]!.isOk()) {
        const batch = results[0].value;
        expect(batch.cursor.metadata?.isComplete).toBe(true);
      }
    }, 30000);
  });

  describe('Cursor Extraction', () => {
    it('should extract correct cursor types from transactions', async () => {
      const operation = { type: 'getAddressTransactions' as const, address: testAddress };
      const stream = client.executeStreaming<SubstrateTransaction>(operation);

      for await (const result of stream) {
        if (result.isErr()) {
          console.error('Streaming error (cursor test):', result.error);
        }
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;

        if (batch.data.length > 0) {
          const tx = batch.data[0]!.normalized;
          const cursors = client.extractCursors(tx);

          expect(Array.isArray(cursors)).toBe(true);
          // Should have blockNumber and timestamp
          const blockCursor = cursors.find((c) => c.type === 'blockNumber');
          const timestampCursor = cursors.find((c) => c.type === 'timestamp');

          expect(blockCursor).toBeDefined();
          expect(timestampCursor).toBeDefined();

          if (blockCursor) expect(typeof blockCursor.value).toBe('number');
          if (timestampCursor) expect(typeof timestampCursor.value).toBe('number');

          break;
        }
      }
    }, 30000);
  });
});
