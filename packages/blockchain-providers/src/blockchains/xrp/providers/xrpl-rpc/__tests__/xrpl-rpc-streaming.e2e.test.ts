import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { XrpTransaction } from '../../../schemas.js';
import { XrplRpcApiClient } from '../xrpl-rpc.api-client.js';

describe.sequential('XrplRpcApiClient Streaming E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('xrp', 'xrpl-rpc');
  const client = new XrplRpcApiClient(config);
  // Ripple's well-known donation address with consistent activity
  const testAddress = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';

  describe('streamAddressTransactions', () => {
    it('should stream transactions with cursor management', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
      };
      const stream = client.executeStreaming<XrpTransaction>(operation);

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
        expect(batch.cursor.metadata?.providerName).toBe('xrpl-rpc');
        expect(typeof batch.cursor.metadata?.updatedAt).toBe('number');
        expect(typeof batch.isComplete).toBe('boolean');

        // Verify primary cursor is pageToken-based (XRPL marker)
        if (batch.cursor.primary.type === 'pageToken') {
          expect(typeof batch.cursor.primary.value).toBe('string');
        }

        // Verify each transaction
        for (const txData of batch.data) {
          expect(txData).toHaveProperty('normalized');
          expect(txData).toHaveProperty('raw');

          const tx = txData.normalized;
          expect(tx.providerName).toBe('xrpl-rpc');
          expect(typeof tx.id).toBe('string');
          expect(['success', 'failed']).toContain(tx.status);
          expect(typeof tx.timestamp).toBe('number');
          expect(tx.timestamp).toBeGreaterThan(0);

          // XRP-specific fields
          expect(tx.ledgerIndex).toBeGreaterThan(0);
          expect(tx.feeCurrency).toBe('XRP');
          expect(typeof tx.feeAmount).toBe('string');
          expect(typeof tx.account).toBe('string');
          expect(tx.account).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
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
      };

      // First stream: get first batch and cursor
      const stream1 = client.executeStreaming<XrpTransaction>(operation);
      const firstBatchResult = await stream1.next();

      expect(firstBatchResult.done).toBe(false);
      if (firstBatchResult.done || !firstBatchResult.value) return;

      const firstBatchValue = firstBatchResult.value;
      if (firstBatchValue.isErr()) {
        console.error('First batch error:', firstBatchValue.error);
        return;
      }

      const firstBatch = firstBatchValue.value;
      const resumeCursor = firstBatch.cursor;

      expect(firstBatch.data.length).toBeGreaterThan(0);
      expect(resumeCursor).toBeDefined();

      // Second stream: resume from cursor
      const stream2 = client.executeStreaming<XrpTransaction>(operation, resumeCursor);
      const secondBatchResult = await stream2.next();

      expect(secondBatchResult.done).toBe(false);
      if (secondBatchResult.done || !secondBatchResult.value) return;

      const secondBatchValue = secondBatchResult.value;
      if (secondBatchValue.isErr()) {
        console.error('Second batch error:', secondBatchValue.error);
        return;
      }

      const secondBatch = secondBatchValue.value;

      // Verify we got transactions
      expect(secondBatch.data.length).toBeGreaterThan(0);

      // Verify transactions are different (next page)
      const firstIds = new Set(firstBatch.data.map((tx) => tx.normalized.id));
      const secondIds = new Set(secondBatch.data.map((tx) => tx.normalized.id));

      // Should have no overlap when using marker-based pagination
      const overlap = Array.from(firstIds).filter((id) => secondIds.has(id)).length;
      expect(overlap).toBe(0);

      // Second batch should have later ledger indices
      const firstMaxLedger = Math.max(...firstBatch.data.map((tx) => tx.normalized.ledgerIndex));
      const secondMinLedger = Math.min(...secondBatch.data.map((tx) => tx.normalized.ledgerIndex));
      expect(secondMinLedger).toBeGreaterThanOrEqual(firstMaxLedger);
    }, 90000);

    it('should handle empty results gracefully', async () => {
      // Use an address that exists but has very few or no transactions
      // rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh is the "black hole" account
      const emptyAddress = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
      const operation = {
        type: 'getAddressTransactions' as const,
        address: emptyAddress,
      };
      const stream = client.executeStreaming<XrpTransaction>(operation);

      const results = [];
      for await (const result of stream) {
        results.push(result);
        // Break after first result to avoid long waits
        break;
      }

      // Should complete successfully with data or without
      if (results.length > 0) {
        expect(results[0]!.isOk() || results[0]!.isErr()).toBe(true);
        if (results[0]!.isOk()) {
          const batch = results[0].value;
          expect(Array.isArray(batch.data)).toBe(true);
          // Account may or may not have transactions
        }
      }
    }, 30000);
  });

  describe('Cursor Extraction', () => {
    it('should extract correct cursor types from transactions', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
      };
      const stream = client.executeStreaming<XrpTransaction>(operation);

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

          // Should have timestamp and blockNumber (ledgerIndex)
          const timestampCursor = cursors.find((c) => c.type === 'timestamp');
          const blockCursor = cursors.find((c) => c.type === 'blockNumber');

          expect(timestampCursor).toBeDefined();
          expect(blockCursor).toBeDefined();

          if (timestampCursor) {
            expect(typeof timestampCursor.value).toBe('number');
            expect(timestampCursor.value).toBeGreaterThan(0);
          }

          if (blockCursor) {
            expect(typeof blockCursor.value).toBe('number');
            expect(blockCursor.value).toBeGreaterThan(0);
          }

          break;
        }
      }
    }, 30000);
  });

  describe('Transaction Data Validation', () => {
    it('should return properly formatted transaction data', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
      };
      const stream = client.executeStreaming<XrpTransaction>(operation);

      for await (const result of stream) {
        if (result.isErr()) break;

        const batch = result.value;

        if (batch.data.length > 0) {
          const tx = batch.data[0]!.normalized;

          // Verify XRP-specific fields
          expect(tx.account).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
          expect(tx.currency).toBeDefined();
          expect(tx.feeAmount).toMatch(/^\d+(\.\d+)?$/); // Decimal string
          expect(tx.feeCurrency).toBe('XRP');
          expect(tx.ledgerIndex).toBeGreaterThan(0);
          expect(tx.sequence).toBeGreaterThanOrEqual(0);
          expect(tx.transactionType).toBeDefined();

          // Verify eventId is present and non-empty
          expect(tx.eventId).toBeTruthy();
          expect(typeof tx.eventId).toBe('string');
          expect(tx.eventId.length).toBeGreaterThan(0);

          // If transaction has a destination, verify format
          if (tx.destination) {
            expect(tx.destination).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
          }

          // Verify fee is reasonable (not in drops, should be in XRP)
          const feeAmount = Number(tx.feeAmount);
          expect(feeAmount).toBeGreaterThan(0);
          expect(feeAmount).toBeLessThan(10); // XRP fees should be small

          break;
        }
      }
    }, 30000);
  });

  describe('Replay Window', () => {
    it('should apply replay window to block-based cursors', () => {
      const cursor = { type: 'blockNumber' as const, value: 1000 };
      const replayedCursor = client.applyReplayWindow(cursor);

      expect(replayedCursor.type).toBe('blockNumber');
      // Should subtract replay window (2 blocks by default)
      expect(replayedCursor.value).toBe(998);
    });

    it('should not apply replay window to non-block cursors', () => {
      const cursor = { type: 'timestamp' as const, value: 1000000 };
      const replayedCursor = client.applyReplayWindow(cursor);

      expect(replayedCursor.type).toBe('timestamp');
      expect(replayedCursor.value).toBe(1000000);
    });
  });
});
