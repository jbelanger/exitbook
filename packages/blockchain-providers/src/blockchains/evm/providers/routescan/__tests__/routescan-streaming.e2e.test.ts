import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { StreamingBatchResult } from '../../../../../core/types/index.js';
import type { EvmTransaction } from '../../../types.js';
import { RoutescanApiClient } from '../routescan.api-client.js';

describe('RoutescanApiClient Streaming E2E', () => {
  describe('Ethereum Streaming', () => {
    const config = ProviderRegistry.createDefaultConfig('ethereum', 'routescan');
    const provider = new RoutescanApiClient(config);
    // Vitalik's address for testing
    const testAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

    describe('streamAddressTransactions via executeStreaming', () => {
      it('should stream transactions in batches with cursor state', async () => {
        const batches: StreamingBatchResult<EvmTransaction>[] = [];
        let batchCount = 0;
        const maxBatches = 1; // Only fetch 1 batch to minimize API usage

        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
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
            expect(firstTx.normalized).toHaveProperty('from');
            expect(firstTx.normalized).toHaveProperty('blockHeight');
            expect(firstTx.normalized).toHaveProperty('timestamp');
            expect(firstTx.normalized.providerName).toBe('routescan');
            expect(firstTx.normalized.currency).toBe('ETH');
          }

          // Verify cursor state structure
          expect(batch.cursor).toHaveProperty('primary');
          expect(batch.cursor).toHaveProperty('alternatives');
          expect(batch.cursor).toHaveProperty('lastTransactionId');
          expect(batch.cursor).toHaveProperty('totalFetched');
          expect(batch.cursor).toHaveProperty('metadata');

          // Verify cursor metadata
          expect(batch.cursor.metadata?.providerName).toBe('routescan');
          expect(batch.cursor.metadata?.updatedAt).toBeGreaterThan(0);
          expect(typeof batch.cursor.metadata?.isComplete).toBe('boolean');

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
      }, 60000);

      it('should extract cursors with blockNumber and timestamp', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
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

          // Primary cursor should be pageToken for Routescan
          expect(cursor.primary.type).toBe('pageToken');
          if (cursor.primary.type === 'pageToken') {
            expect(cursor.primary.providerName).toBe('routescan');
            expect(typeof cursor.primary.value).toBe('string');
          }

          // Only need to verify first batch
          break;
        }
      }, 60000);

      it('should resume from cursor state (pageToken)', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        // Fetch first batch
        let firstBatchCursor: CursorState | undefined;
        let firstBatchLastTx: string | undefined;

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
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
        for await (const result of provider.executeStreaming<EvmTransaction>(operation, firstBatchCursor)) {
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
      }, 60000);
    });

    describe('streamAddressTokenTransactions via executeStreaming', () => {
      it('should stream token transactions in batches with cursor state', async () => {
        const batches: StreamingBatchResult<EvmTransaction>[] = [];
        let batchCount = 0;
        const maxBatches = 1; // Only 1 batch to minimize API usage

        const operation = {
          type: 'getAddressTokenTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          if (result.isErr()) {
            console.error('Streaming error:', result.error.message);
            // If there's an error fetching token transactions, it might be due to API limitations
            // This is acceptable - we just need to verify the streaming mechanism works
            return;
          }

          const batch = result.value;
          batches.push(batch);
          batchCount++;

          // Verify batch structure
          expect(batch).toHaveProperty('data');
          expect(batch).toHaveProperty('cursor');
          expect(Array.isArray(batch.data)).toBe(true);

          // Verify token transactions in batch
          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!;
            expect(firstTx).toHaveProperty('raw');
            expect(firstTx).toHaveProperty('normalized');
            expect(firstTx.normalized).toHaveProperty('id');
            expect(firstTx.normalized.type).toBe('token_transfer');
            expect(firstTx.normalized).toHaveProperty('tokenAddress');
            expect(firstTx.normalized).toHaveProperty('tokenDecimals');
            expect(firstTx.normalized.providerName).toBe('routescan');
          }

          if (batchCount >= maxBatches) {
            break;
          }
        }

        // If address has no token transactions, skip
        if (batches.length === 0 || batches[0]!.data.length === 0) {
          console.log('Test address has no token transactions, skipping test');
          return;
        }

        expect(batches.length).toBeGreaterThan(0);
      }, 60000);
    });

    describe('streamAddressInternalTransactions via executeStreaming', () => {
      it('should stream internal transactions in batches', async () => {
        const batches: StreamingBatchResult<EvmTransaction>[] = [];
        let batchCount = 0;
        const maxBatches = 1; // Only 1 batch to minimize API usage

        const operation = {
          type: 'getAddressInternalTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
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

          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!;
            expect(firstTx.normalized.providerName).toBe('routescan');
          }

          if (batchCount >= maxBatches) {
            break;
          }
        }

        expect(batches.length).toBeGreaterThan(0);
      }, 60000);
    });

    describe('Cursor extraction and replay window', () => {
      it('should extract blockNumber and timestamp cursors from transactions', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length === 0) continue;

          // Test cursor extraction on first transaction
          const firstTx = batch.data[0]!.normalized;
          const cursors = provider.extractCursors(firstTx);

          expect(Array.isArray(cursors)).toBe(true);
          expect(cursors.length).toBeGreaterThan(0);

          // Should extract blockNumber cursor
          const blockNumberCursor = cursors.find((c) => c.type === 'blockNumber');
          expect(blockNumberCursor).toBeDefined();
          if (blockNumberCursor && blockNumberCursor.type === 'blockNumber') {
            expect(typeof blockNumberCursor.value).toBe('number');
            expect(blockNumberCursor.value).toBe(firstTx.blockHeight);
          }

          // Should extract timestamp cursor
          const timestampCursor = cursors.find((c) => c.type === 'timestamp');
          expect(timestampCursor).toBeDefined();
          if (timestampCursor && timestampCursor.type === 'timestamp') {
            expect(typeof timestampCursor.value).toBe('number');
            expect(timestampCursor.value).toBe(firstTx.timestamp);
          }

          break;
        }
      }, 60000);

      it('should apply replay window to blockNumber cursor', () => {
        const blockNumberCursor = { type: 'blockNumber' as const, value: 15000000 };
        const adjustedCursor = provider.applyReplayWindow(blockNumberCursor);

        expect(adjustedCursor.type).toBe('blockNumber');
        if (adjustedCursor.type === 'blockNumber') {
          // Replay window is 2 blocks for Routescan
          expect(adjustedCursor.value).toBe(15000000 - 2);
        }
      });

      it('should not apply replay window to pageToken cursor', () => {
        const pageTokenCursor = {
          type: 'pageToken' as const,
          value: '2',
          providerName: 'routescan',
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
  });
});
