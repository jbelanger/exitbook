import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { SubstrateTransaction } from '../../../types.js';
import { SubscanApiClient } from '../subscan.api-client.js';

describe.sequential('SubscanApiClient Streaming E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('polkadot', 'subscan');
  const client = new SubscanApiClient(config);
  // Test address with some activity but not too much (to avoid rate limiting)
  // This is a known address from Polkadot Wiki with limited transactions
  const testAddress = '1zugcavYA9yCuYwiEYeMHNJm9gXznYjNfXQjZsZukF1Mpow';

  describe('streamAddressTransactions', () => {
    it('should stream transactions with cursor management', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };
      const stream = client.executeStreaming<SubstrateTransaction>(operation);

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
        expect(batch.cursor.metadata?.providerName).toBe('subscan');
        expect(typeof batch.cursor.metadata?.updatedAt).toBe('number');
        expect(typeof batch.isComplete).toBe('boolean');

        // Verify primary cursor is pageToken
        if (batch.cursor.primary.type === 'pageToken') {
          expect(batch.cursor.primary.providerName).toBe('subscan');
          expect(typeof batch.cursor.primary.value).toBe('string');
        }

        // Verify each transaction
        for (const txData of batch.data) {
          expect(txData).toHaveProperty('normalized');
          expect(txData).toHaveProperty('raw');

          const tx = txData.normalized;
          expect(tx.providerName).toBe('subscan');
          expect(typeof tx.id).toBe('string');
          expect(['success', 'failed', 'pending']).toContain(tx.status);
          expect(typeof tx.timestamp).toBe('number');
          expect(tx.currency).toBe('DOT');
          expect(tx.chainName).toBe('polkadot');
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
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

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

      // Verify we got different transactions
      const firstIds = new Set(firstBatch.data.map((tx) => tx.normalized.id));
      const secondIds = new Set(secondBatch.data.map((tx) => tx.normalized.id));

      // Should have no overlap - Subscan uses page-based pagination
      const overlap = Array.from(firstIds).filter((id) => secondIds.has(id)).length;

      expect(overlap).toBe(0); // No overlap expected with page-based pagination
    }, 90000);

    it('should handle pagination correctly', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };
      const stream = client.executeStreaming<SubstrateTransaction>(operation);

      const seenTransactionIds = new Set<string>();
      let batchCount = 0;
      const maxBatches = 3;

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        batchCount++;

        // Verify no duplicate transactions across batches
        for (const txData of batch.data) {
          const txId = txData.normalized.id;
          expect(seenTransactionIds.has(txId)).toBe(false);
          seenTransactionIds.add(txId);
        }

        if (batchCount >= maxBatches || batch.isComplete) {
          break;
        }
      }

      expect(batchCount).toBeGreaterThan(0);
      expect(seenTransactionIds.size).toBeGreaterThan(0);
    }, 90000);

    it('should handle empty results gracefully', async () => {
      // Use an address format that might not have transactions
      const emptyAddress = '15kUt2i86LHRWCkE3D9Bg1HZAoc2smhn1fwPzDERTb1BXAkX';
      const operation = {
        type: 'getAddressTransactions' as const,
        address: emptyAddress,
        transactionType: 'normal' as const,
      };
      const stream = client.executeStreaming<SubstrateTransaction>(operation);

      const results = [];
      for await (const result of stream) {
        results.push(result);
      }

      // Should either complete successfully with no data or fail
      if (results.length > 0 && results[0]!.isOk()) {
        const batch = results[0].value;
        expect(batch.isComplete).toBe(true);
      }
    }, 30000);
  });

  describe('Cursor Types and Replay Window', () => {
    it('should extract correct cursor types from transactions', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };
      const stream = client.executeStreaming<SubstrateTransaction>(operation);

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

          // May also have blockNumber cursor
          const blockCursor = cursors.find((c) => c.type === 'blockNumber');
          if (blockCursor) {
            expect(typeof blockCursor.value).toBe('number');
          }

          break;
        }
      }
    }, 30000);

    it('should not apply replay window (page-based pagination is precise)', () => {
      const timestampCursor = { type: 'timestamp' as const, value: 1000000 };
      const replayedTimestampCursor = client.applyReplayWindow(timestampCursor);

      expect(replayedTimestampCursor.type).toBe('timestamp');
      expect(replayedTimestampCursor.value).toBe(1000000); // Unchanged

      const blockCursor = { type: 'blockNumber' as const, value: 100 };
      const replayedBlockCursor = client.applyReplayWindow(blockCursor);

      expect(replayedBlockCursor.type).toBe('blockNumber');
      expect(replayedBlockCursor.value).toBe(100); // Unchanged - no replay window
    });
  });

  describe('Transaction Data Quality', () => {
    it('should include all required fields in streamed transactions', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };
      const stream = client.executeStreaming<SubstrateTransaction>(operation);

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;

        if (batch.data.length > 0) {
          const txData = batch.data[0]!;
          const tx = txData.normalized;

          // Required fields
          expect(tx.id).toBeDefined();
          expect(tx.from).toBeDefined();
          expect(tx.to).toBeDefined();
          expect(tx.amount).toBeDefined();
          expect(tx.currency).toBe('DOT');
          expect(tx.timestamp).toBeDefined();
          expect(tx.status).toBeDefined();
          expect(tx.providerName).toBe('subscan');

          // Fee information
          if (tx.feeAmount) {
            expect(typeof tx.feeAmount).toBe('string');
            expect(tx.feeCurrency).toBe('DOT');
          }

          // Substrate-specific fields
          if (tx.blockHeight !== undefined) {
            expect(typeof tx.blockHeight).toBe('number');
          }

          if (tx.extrinsicIndex) {
            expect(typeof tx.extrinsicIndex).toBe('string');
          }

          break;
        }
      }
    }, 30000);
  });
});
