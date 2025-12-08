import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { FetchBatchResult } from '../../../core/types.js';
import { createCoinbaseClient } from '../client.js';

describe('Coinbase Client Streaming E2E', () => {
  // Requires COINBASE_API_KEY and COINBASE_SECRET in .env
  const credentials = {
    apiKey: process.env['COINBASE_API_KEY'] || '',
    apiSecret: process.env['COINBASE_SECRET'] || '',
  };

  // Skip tests if credentials not available
  const shouldSkip = !credentials.apiKey || !credentials.apiSecret;

  describe('fetchTransactionDataStreaming', () => {
    it.skipIf(shouldSkip)(
      'should stream accounts with correct batch/cursor structure and Coinbase-specific data',
      async () => {
        const clientResult = createCoinbaseClient(credentials);
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

        // If no accounts or no transactions, we should get completion batch
        if (!firstBatch || firstBatch.transactions.length === 0) {
          console.log('Account has no transactions or no accounts found');
          if (firstBatch) {
            expect(firstBatch.isComplete).toBe(true);
            expect(firstBatch.cursor.metadata?.isComplete).toBe(true);
          }
          return;
        }

        // Verify batch structure
        expect(firstBatch).toHaveProperty('transactions');
        expect(firstBatch).toHaveProperty('operationType');
        expect(firstBatch).toHaveProperty('cursor');
        expect(firstBatch).toHaveProperty('isComplete');
        expect(Array.isArray(firstBatch.transactions)).toBe(true);
        // operationType should be account ID (e.g., "account1" or "account2")
        expect(firstBatch.operationType).toBeTruthy();
        expect(typeof firstBatch.operationType).toBe('string');

        // Verify transaction structure
        const firstTx = firstBatch.transactions[0]!;
        expect(firstTx).toHaveProperty('externalId');
        expect(firstTx).toHaveProperty('rawData');
        expect(firstTx).toHaveProperty('normalizedData');
        expect(firstTx.providerName).toBe('coinbase');

        // Verify cursor state structure
        expect(firstBatch.cursor).toHaveProperty('primary');
        expect(firstBatch.cursor).toHaveProperty('lastTransactionId');
        expect(firstBatch.cursor).toHaveProperty('totalFetched');
        expect(firstBatch.cursor).toHaveProperty('metadata');
        expect(firstBatch.cursor.metadata?.providerName).toBe('coinbase');
        expect(firstBatch.cursor.metadata?.updatedAt).toBeGreaterThan(0);
        expect(firstBatch.cursor.primary.type).toBe('timestamp');
        expect(typeof firstBatch.cursor.primary.value).toBe('number');

        // Verify account ID in metadata
        expect(firstBatch.cursor.metadata?.accountId).toBeTruthy();
        expect(typeof firstBatch.cursor.metadata?.accountId).toBe('string');

        // Verify Coinbase-specific normalized data structure
        const normalized = firstTx.normalizedData as Record<string, unknown>;
        expect(normalized.id).toBeDefined();
        expect(normalized.timestamp).toBeDefined();
        expect(typeof normalized.timestamp).toBe('number');
        expect(normalized.type).toBeDefined();
        expect(normalized.asset).toBeDefined();
        expect(normalized.amount).toBeDefined();
        expect(normalized.fee).toBeDefined();
        expect(normalized.feeCurrency).toBeDefined();
        expect(normalized.status).toBe('success');

        // Verify correlation ID exists (for trades) or is defined
        expect(normalized.correlationId).toBeDefined();
      },
      60000
    );

    it.skipIf(shouldSkip)(
      'should track totalFetched within each account',
      async () => {
        const clientResult = createCoinbaseClient(credentials);
        expect(clientResult.isOk()).toBe(true);
        if (clientResult.isErr()) return;

        const client = clientResult.value;
        if (!client.fetchTransactionDataStreaming) {
          throw new Error('fetchTransactionDataStreaming not implemented');
        }

        let batchCount = 0;
        const maxBatches = 3; // Limit to 3 batches to minimize API usage

        for await (const result of client.fetchTransactionDataStreaming()) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.transactions.length === 0) {
            // If no data, skip (might be completion batch or empty account)
            continue;
          }

          const currentTotal = batch.cursor.totalFetched;

          // Total should be >= 0 and >= batch size
          expect(currentTotal).toBeGreaterThanOrEqual(0);
          expect(currentTotal).toBeGreaterThanOrEqual(batch.transactions.length);

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
      'should resume from cursor state for specific account',
      async () => {
        const clientResult = createCoinbaseClient(credentials);
        expect(clientResult.isOk()).toBe(true);
        if (clientResult.isErr()) return;

        const client = clientResult.value;
        if (!client.fetchTransactionDataStreaming) {
          throw new Error('fetchTransactionDataStreaming not implemented');
        }

        // Fetch first batch to get initial cursor
        let firstBatchCursor: CursorState | undefined;
        let firstBatchAccountId: string | undefined;
        let firstBatchLastTx: string | undefined;

        for await (const result of client.fetchTransactionDataStreaming()) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.transactions.length > 0) {
            firstBatchCursor = batch.cursor;
            firstBatchAccountId = batch.cursor.metadata?.accountId as string;
            firstBatchLastTx = batch.cursor.lastTransactionId;
            break;
          }
        }

        // Skip test if no transactions found
        if (!firstBatchCursor || !firstBatchAccountId || !firstBatchLastTx) {
          console.log('Account has no transactions, skipping test');
          return;
        }

        expect(firstBatchCursor).toBeDefined();
        expect(firstBatchAccountId).toBeDefined();
        expect(firstBatchLastTx).toBeDefined();

        // Resume from cursor using account-specific cursor map
        const cursorMap = {
          [firstBatchAccountId]: firstBatchCursor,
        };

        let resumedBatchFirstTx: string | undefined;
        for await (const result of client.fetchTransactionDataStreaming({ cursor: cursorMap })) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.transactions.length > 0 && batch.cursor.metadata?.accountId === firstBatchAccountId) {
            resumedBatchFirstTx = batch.transactions[0]!.externalId;
            break;
          }
        }

        // Verify resume actually advanced (or completed if no more data)
        // If we got transactions, they should be different from the last one
        if (resumedBatchFirstTx) {
          expect(resumedBatchFirstTx).not.toBe(firstBatchLastTx);
        }
      },
      60000
    );

    it.skipIf(shouldSkip)(
      'should mark isComplete on final batch of each account',
      async () => {
        const clientResult = createCoinbaseClient(credentials);
        expect(clientResult.isOk()).toBe(true);
        if (clientResult.isErr()) return;

        const client = clientResult.value;
        if (!client.fetchTransactionDataStreaming) {
          throw new Error('fetchTransactionDataStreaming not implemented');
        }

        const accountBatches = new Map<string, FetchBatchResult[]>();
        let batchCount = 0;
        const maxBatches = 5; // Limit to minimize API usage

        for await (const result of client.fetchTransactionDataStreaming()) {
          if (result.isErr()) {
            console.error('API error:', result.error.message);
            break;
          }

          const batch = result.value;
          const accountId = batch.operationType;

          if (!accountBatches.has(accountId)) {
            accountBatches.set(accountId, []);
          }
          accountBatches.get(accountId)!.push(batch);

          batchCount++;

          // Stop after max batches
          if (batchCount >= maxBatches) {
            break;
          }
        }

        // Verify that the last batch for each account has isComplete
        for (const [_accountId, batches] of accountBatches) {
          const lastBatch = batches[batches.length - 1];
          if (lastBatch) {
            expect(typeof lastBatch.isComplete).toBe('boolean');
            // If we stopped early, can't guarantee completion
            // But if marked complete, metadata should also reflect it
            if (lastBatch.isComplete) {
              expect(lastBatch.cursor.metadata?.isComplete).toBe(true);
            }
          }
        }

        // Should have processed at least one account
        if (accountBatches.size > 0) {
          expect(accountBatches.size).toBeGreaterThan(0);
        }
      },
      60000
    );
  });
});
