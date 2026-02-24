import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { FetchBatchResult } from '../../../core/types.js';
import { createKrakenClient } from '../client.js';

type KrakenCursorMetadata = CursorState['metadata'] & {
  offset?: number | undefined;
};

describe('Kraken Client Streaming E2E', () => {
  // Requires KRAKEN_API_KEY and KRAKEN_SECRET in .env
  const credentials = {
    apiKey: process.env['KRAKEN_API_KEY'] || '',
    apiSecret: process.env['KRAKEN_SECRET'] || '',
  };

  // Skip tests if credentials not available
  const shouldSkip = !credentials.apiKey || !credentials.apiSecret;

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
        expect(firstTx).toHaveProperty('eventId');
        expect(firstTx).toHaveProperty('providerData');
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
        const metadata = firstBatch.cursor.metadata as KrakenCursorMetadata;
        expect(typeof metadata?.offset).toBe('number');
        expect(metadata?.offset).toBe(firstBatch.cursor.totalFetched);

        // Verify raw Kraken API data in providerData
        const raw = firstTx.providerData as Record<string, unknown>;
        expect(raw['id']).toBeDefined();
        expect(raw['refid']).toBeDefined();
        expect(raw['time']).toBeDefined();
        expect(typeof raw['time']).toBe('number');
        expect(raw['type']).toBeDefined();
        expect(raw['asset']).toBeDefined();
        expect(raw['amount']).toBeDefined();
        expect(raw['fee']).toBeDefined();

        // Verify raw asset field exists (normalization happens in processor)
        expect(typeof raw['asset']).toBe('string');
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
            resumedBatchFirstTx = batch.transactions[0]!.eventId;
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
  });
});
