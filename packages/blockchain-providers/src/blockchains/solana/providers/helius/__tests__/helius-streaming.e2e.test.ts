import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { SolanaTransaction } from '../../../schemas.ts';
import { HeliusApiClient } from '../helius.api-client.js';

describe.sequential('HeliusApiClient Streaming E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('solana', 'helius');
  const client = new HeliusApiClient(config);
  // Solana Foundation Donate Address (high volume)
  const testAddress = 'EpZeFeF2o1E98qFr8Gat2JgE517Z58K71Q515325515';

  /**
   * LIMITATION: These are live API tests that require a valid HELIUS_API_KEY.
   * They are skipped by default to prevent CI failures and rate limit issues.
   * To run them, ensure you have a valid HELIUS_API_KEY in your environment.
   */
  describe('streamAddressTransactions', () => {
    it.skip('should stream transactions with cursor management', async () => {
      const operation = { type: 'getAddressTransactions' as const, address: testAddress };
      const stream = client.executeStreaming<SolanaTransaction>(operation);

      let batchCount = 0;
      let totalTransactions = 0;
      let lastCursor: CursorState | undefined;
      const maxBatches = 2; // Limit for testing

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
        expect(batch.cursor.metadata?.providerName).toBe('helius');
        expect(typeof batch.cursor.metadata?.updatedAt).toBe('number');
        expect(typeof batch.isComplete).toBe('boolean');

        // Verify primary cursor is signature-based (pageToken)
        if (batch.cursor.primary.type === 'pageToken') {
          expect(batch.cursor.primary.providerName).toBe('helius');
          expect(typeof batch.cursor.primary.value).toBe('string');
        }

        // Verify each transaction
        for (const txData of batch.data) {
          expect(txData).toHaveProperty('normalized');
          expect(txData).toHaveProperty('raw');

          const tx = txData.normalized;
          expect(tx.providerName).toBe('helius');
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
    }, 60000);

    it.skip('should resume streaming from cursor', async () => {
      const operation = { type: 'getAddressTransactions' as const, address: testAddress };

      // First stream: get first batch and cursor
      const stream1 = client.executeStreaming<SolanaTransaction>(operation);
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
      const stream2 = client.executeStreaming<SolanaTransaction>(operation, resumeCursor);
      const secondBatchResult = await stream2.next();

      expect(secondBatchResult.done).toBe(false);
      if (secondBatchResult.done || !secondBatchResult.value) return;

      const secondBatchValue = secondBatchResult.value;
      if (secondBatchValue.isErr()) return;

      const secondBatch = secondBatchValue.value;

      // Verify we got different transactions (next page)
      const firstIds = new Set(firstBatch.data.map((tx) => tx.normalized.id));
      const secondIds = new Set(secondBatch.data.map((tx) => tx.normalized.id));

      // Should have no overlap when using signature-based pagination
      const overlap = Array.from(firstIds).filter((id) => secondIds.has(id)).length;
      expect(overlap).toBe(0);
    }, 60000);

    it.skip('should handle empty results gracefully', async () => {
      // Random address that should have no transactions
      const emptyAddress = '11111111111111111111111111111111';
      const operation = { type: 'getAddressTransactions' as const, address: emptyAddress };
      const stream = client.executeStreaming<SolanaTransaction>(operation);

      const results = [];
      for await (const result of stream) {
        results.push(result);
      }

      // Should either complete successfully with no data or fail validation (if address invalid)
      if (results.length > 0 && results[0]!.isOk()) {
        const batch = results[0].value;
        expect(batch.data.length).toBe(0);
        expect(batch.isComplete).toBe(true);
      }
    }, 30000);
  });

  describe('Cursor Extraction', () => {
    it.skip('should extract correct cursor types from transactions', async () => {
      const operation = { type: 'getAddressTransactions' as const, address: testAddress };
      const stream = client.executeStreaming<SolanaTransaction>(operation);

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
          // Should have timestamp and blockNumber
          const timestampCursor = cursors.find((c) => c.type === 'timestamp');
          const blockCursor = cursors.find((c) => c.type === 'blockNumber');

          expect(timestampCursor).toBeDefined();
          expect(blockCursor).toBeDefined();

          if (timestampCursor) expect(typeof timestampCursor.value).toBe('number');
          if (blockCursor) expect(typeof blockCursor.value).toBe('number');

          break;
        }
      }
    }, 30000);
  });
});
