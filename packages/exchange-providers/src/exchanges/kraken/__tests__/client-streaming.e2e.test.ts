import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { FetchBatchResult } from '../../../core/types.js';
import { createKrakenClient } from '../client.js';

describe('Kraken Client Streaming E2E', () => {
  // Requires KRAKEN_API_KEY and KRAKEN_SECRET in .env
  const credentials = {
    apiKey: process.env['KRAKEN_API_KEY'] || '',
    secret: process.env['KRAKEN_SECRET'] || '',
  };

  // Skip tests if credentials not available
  const shouldSkip = !credentials.apiKey || !credentials.secret;

  describe('fetchTransactionDataStreaming', () => {
    it.skipIf(shouldSkip)(
      'should stream ledger with correct batch/cursor structure, offset metadata, and normalized Kraken data',
      async () => {
        const clientResult = createKrakenClient(credentials);
        expect(clientResult.isOk()).toBe(true);
        if (clientResult.isErr()) return;

        const client = clientResult.value;
        if (!client.fetchTransactionDataStreaming) {
          throw new Error('fetchTransactionDataStreaming not implemented');
        }

        let firstBatch: FetchBatchResult | undefined;

        for await (const result of client.fetchTransactionDataStreaming()) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) {
            console.error('Streaming error:', result.error.message);
            break;
          }

          firstBatch = result.value;
          break; // Only need first batch for structure validation
        }

        // If account has no transactions, we should get completion batch
        if (!firstBatch || firstBatch.transactions.length === 0) {
          console.log('Account has no transactions');
          if (firstBatch) {
            expect(firstBatch.isComplete).toBe(true);
            expect(firstBatch.cursor.lastTransactionId).toBe('kraken:ledger:none');
          }
          return;
        }

        // Verify batch structure
        expect(firstBatch).toHaveProperty('transactions');
        expect(firstBatch).toHaveProperty('operationType');
        expect(firstBatch).toHaveProperty('cursor');
        expect(firstBatch).toHaveProperty('isComplete');
        expect(Array.isArray(firstBatch.transactions)).toBe(true);
        expect(firstBatch.operationType).toBe('ledger');

        // Verify transaction structure
        const firstTx = firstBatch.transactions[0]!;
        expect(firstTx).toHaveProperty('externalId');
        expect(firstTx).toHaveProperty('rawData');
        expect(firstTx).toHaveProperty('normalizedData');
        expect(firstTx.providerName).toBe('kraken');

        // Verify cursor state structure
        expect(firstBatch.cursor).toHaveProperty('primary');
        expect(firstBatch.cursor).toHaveProperty('lastTransactionId');
        expect(firstBatch.cursor).toHaveProperty('totalFetched');
        expect(firstBatch.cursor).toHaveProperty('metadata');
        expect(firstBatch.cursor.metadata?.providerName).toBe('kraken');
        expect(firstBatch.cursor.metadata?.updatedAt).toBeGreaterThan(0);
        expect(firstBatch.cursor.primary.type).toBe('timestamp');
        expect(typeof firstBatch.cursor.primary.value).toBe('number');

        // Verify offset metadata for resumption
        expect(typeof firstBatch.cursor.metadata?.offset).toBe('number');
        expect(firstBatch.cursor.metadata?.offset).toBe(firstBatch.cursor.totalFetched);

        // Verify Kraken-specific normalized data structure
        const normalized = firstTx.normalizedData as Record<string, unknown>;
        expect(normalized.id).toBeDefined();
        expect(normalized.correlationId).toBeDefined();
        expect(normalized.timestamp).toBeDefined();
        expect(typeof normalized.timestamp).toBe('number');
        expect(normalized.type).toBeDefined();
        expect(normalized.asset).toBeDefined();
        expect(normalized.amount).toBeDefined();
        expect(normalized.fee).toBeDefined();
        expect(normalized.feeCurrency).toBeDefined();
        expect(normalized.status).toBe('success');

        // Verify asset normalization (should not have Kraken prefixes)
        const asset = normalized.asset as string;
        expect(asset).toBeDefined();
        expect(typeof asset).toBe('string');
        expect(asset).not.toMatch(/^Z[A-Z]{3}$/); // e.g., ZUSD
        expect(asset).not.toMatch(/^X[A-Z]{2,3}$/); // e.g., XXBT, XETH
      },
      60000
    );

    it.skipIf(shouldSkip)(
      'should track totalFetched across batches',
      async () => {
        const clientResult = createKrakenClient(credentials);
        expect(clientResult.isOk()).toBe(true);
        if (clientResult.isErr()) return;

        const client = clientResult.value;
        if (!client.fetchTransactionDataStreaming) {
          throw new Error('fetchTransactionDataStreaming not implemented');
        }

        let previousTotal = 0;
        let batchCount = 0;
        const maxBatches = 2; // Only 2 batches to minimize API usage

        for await (const result of client.fetchTransactionDataStreaming()) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.transactions.length === 0) {
            // If no data, we've reached the end
            break;
          }

          const currentTotal = batch.cursor.totalFetched;

          // Total should increase with each batch
          expect(currentTotal).toBeGreaterThan(previousTotal);

          // Total should equal previous total plus current batch size
          const expectedTotal = previousTotal + batch.transactions.length;
          expect(currentTotal).toBe(expectedTotal);

          previousTotal = currentTotal;
          batchCount++;

          if (batchCount >= maxBatches) break;
        }

        // If we got at least 1 batch with data, test passes
        if (batchCount === 0) {
          console.log('Account has no transactions, skipping test');
        } else {
          expect(batchCount).toBeGreaterThan(0);
        }
      },
      60000
    );

    it.skipIf(shouldSkip)(
      'should resume from cursor state',
      async () => {
        const clientResult = createKrakenClient(credentials);
        expect(clientResult.isOk()).toBe(true);
        if (clientResult.isErr()) return;

        const client = clientResult.value;
        if (!client.fetchTransactionDataStreaming) {
          throw new Error('fetchTransactionDataStreaming not implemented');
        }

        // Fetch first batch
        let firstBatchCursor: CursorState | undefined;
        let firstBatchLastTx: string | undefined;

        for await (const result of client.fetchTransactionDataStreaming()) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.transactions.length > 0) {
            firstBatchCursor = batch.cursor;
            firstBatchLastTx = batch.cursor.lastTransactionId;
            break;
          }
        }

        // Skip test if no transactions found
        if (!firstBatchCursor || !firstBatchLastTx) {
          console.log('Account has no transactions, skipping test');
          return;
        }

        expect(firstBatchCursor).toBeDefined();
        expect(firstBatchLastTx).toBeDefined();

        // Resume from cursor (only fetch 1 more batch)
        let resumedBatchFirstTx: string | undefined;
        for await (const result of client.fetchTransactionDataStreaming({ cursor: { ledger: firstBatchCursor } })) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.transactions.length > 0) {
            resumedBatchFirstTx = batch.transactions[0]!.externalId;
            break;
          }
        }

        // Verify resume actually advanced: first tx of resumed batch must differ from last tx of first batch
        if (resumedBatchFirstTx) {
          expect(resumedBatchFirstTx).not.toBe(firstBatchLastTx);
        }
      },
      60000
    );

    it.skipIf(shouldSkip)(
      'should mark isComplete on final batch',
      async () => {
        const clientResult = createKrakenClient(credentials);
        expect(clientResult.isOk()).toBe(true);
        if (clientResult.isErr()) return;

        const client = clientResult.value;
        if (!client.fetchTransactionDataStreaming) {
          throw new Error('fetchTransactionDataStreaming not implemented');
        }

        let lastBatch: FetchBatchResult | undefined;
        let batchCount = 0;
        const maxBatches = 2; // Reduced from 5 to minimize API usage

        for await (const result of client.fetchTransactionDataStreaming()) {
          if (result.isErr()) {
            console.error('API error:', result.error.message);
            break;
          }

          lastBatch = result.value;
          batchCount++;

          // Stop if we hit completion or max batches
          if (lastBatch.isComplete || batchCount >= maxBatches) {
            break;
          }
        }

        if (lastBatch) {
          // Verify isComplete logic: either true when complete, or false when we stopped early
          expect(typeof lastBatch.isComplete).toBe('boolean');
          if (batchCount < maxBatches) {
            expect(lastBatch.isComplete).toBe(true);
          }
        }
      },
      60000
    );
  });
});
