import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { StreamingBatchResult } from '../../../../../core/types/index.js';
import type { CosmosTransaction } from '../../../types.js';
import { InjectiveExplorerApiClient } from '../injective-explorer.api-client.js';

describe('InjectiveExplorerApiClient Streaming E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('injective', 'injective-explorer');
  const provider = new InjectiveExplorerApiClient(config);
  // Test address with some activity
  const testAddress = 'inj1zk3259rhsxcg5qg96eursm4x8ek2qc5pty4rau';
  // Empty address for completion tests
  const emptyAddress = 'inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqe2hm49';

  describe('streamAddressTransactions via executeStreaming', () => {
    it('should stream transactions in batches with cursor state', async () => {
      const batches: StreamingBatchResult<CosmosTransaction>[] = [];
      let batchCount = 0;
      const maxBatches = 2; // Only fetch 2 batches to minimize API usage

      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
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
          expect(firstTx.normalized).toHaveProperty('timestamp');
          expect(firstTx.normalized).toHaveProperty('status');
          expect(firstTx.normalized.providerName).toBe('injective-explorer');
          expect(firstTx.normalized.feeCurrency).toBe('INJ');
          expect(typeof firstTx.normalized.blockHeight).toBe('number');
          expect(typeof firstTx.normalized.timestamp).toBe('number');
        }

        // Verify cursor state structure
        expect(batch.cursor).toHaveProperty('primary');
        expect(batch.cursor).toHaveProperty('alternatives');
        expect(batch.cursor).toHaveProperty('lastTransactionId');
        expect(batch.cursor).toHaveProperty('totalFetched');
        expect(batch.cursor).toHaveProperty('metadata');

        // Verify cursor metadata
        expect(batch.cursor.metadata?.providerName).toBe('injective-explorer');
        expect(batch.cursor.metadata?.updatedAt).toBeGreaterThan(0);
        expect(typeof batch.isComplete).toBe('boolean');

        // Limit test to avoid API usage
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

    it('should extract cursors with txHash, blockNumber and timestamp', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length === 0) continue;

        // Verify cursor extraction
        const cursor = batch.cursor;

        // Should have alternatives containing txHash, blockNumber and timestamp
        expect(cursor.alternatives).toBeDefined();
        expect(Array.isArray(cursor.alternatives)).toBe(true);

        const txHashCursor = cursor.alternatives?.find((c) => c.type === 'txHash');
        const blockNumberCursor = cursor.alternatives?.find((c) => c.type === 'blockNumber');
        const timestampCursor = cursor.alternatives?.find((c) => c.type === 'timestamp');

        expect(txHashCursor).toBeDefined();
        expect(blockNumberCursor).toBeDefined();
        expect(timestampCursor).toBeDefined();

        if (txHashCursor && txHashCursor.type === 'txHash') {
          expect(typeof txHashCursor.value).toBe('string');
          expect(txHashCursor.value.length).toBeGreaterThan(0);
        }

        if (blockNumberCursor && blockNumberCursor.type === 'blockNumber') {
          expect(typeof blockNumberCursor.value).toBe('number');
          expect(blockNumberCursor.value).toBeGreaterThan(0);
        }

        if (timestampCursor && timestampCursor.type === 'timestamp') {
          expect(typeof timestampCursor.value).toBe('number');
          expect(timestampCursor.value).toBeGreaterThan(0);
        }

        // Primary cursor should be pageToken for Injective (wraps the skip offset)
        // Or blockNumber if that's the preferred cursor type
        expect(['pageToken', 'blockNumber']).toContain(cursor.primary.type);
        if (cursor.primary.type === 'pageToken') {
          expect(cursor.primary.providerName).toBe('injective-explorer');
          expect(typeof cursor.primary.value).toBe('string');
        } else if (cursor.primary.type === 'blockNumber') {
          expect(typeof cursor.primary.value).toBe('number');
        }

        // Only need to verify first batch
        break;
      }
    }, 60000);

    it('should track totalFetched across batches', async () => {
      let previousTotal = 0;
      let batchCount = 0;
      const maxBatches = 2; // Only 2 batches to minimize API usage

      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
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
    }, 60000);

    it('should resume from cursor state (pageToken)', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      // Fetch first batch
      let firstBatchCursor: CursorState | undefined;
      let firstBatchLastTx: string | undefined;

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
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
      for await (const result of provider.executeStreaming<CosmosTransaction>(operation, firstBatchCursor)) {
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

    it('should handle deduplication during cross-provider resume', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      // Fetch first batch and get its cursor
      let firstBatchCursor: CursorState | undefined;
      const firstBatchLastId = new Set<string>();

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
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
      for await (const result of provider.executeStreaming<CosmosTransaction>(operation, crossProviderCursor)) {
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

    it('should mark isComplete when no more data available', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: emptyAddress,
        transactionType: 'normal' as const,
      };

      let lastBatch: StreamingBatchResult<CosmosTransaction> | undefined;
      let hadError = false;

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
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
    }, 60000);
  });

  describe('Cursor extraction and replay window', () => {
    it('should extract txHash, blockNumber and timestamp cursors from transactions', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length === 0) continue;

        const firstTx = batch.data[0]!;

        // Test cursor extraction on transaction
        const cursors = provider.extractCursors(firstTx.normalized);

        expect(Array.isArray(cursors)).toBe(true);
        expect(cursors.length).toBeGreaterThan(0);

        // Should extract txHash cursor
        const txHashCursor = cursors.find((c) => c.type === 'txHash');
        expect(txHashCursor).toBeDefined();
        if (txHashCursor && txHashCursor.type === 'txHash') {
          expect(typeof txHashCursor.value).toBe('string');
          expect(txHashCursor.value).toBe(firstTx.normalized.id);
        }

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
    }, 60000);

    it('should apply replay window to blockNumber cursor', () => {
      const blockNumberCursor = { type: 'blockNumber' as const, value: 50000000 };
      const adjustedCursor = provider.applyReplayWindow(blockNumberCursor);

      expect(adjustedCursor.type).toBe('blockNumber');
      if (adjustedCursor.type === 'blockNumber') {
        // Replay window is 5 blocks for Injective
        expect(adjustedCursor.value).toBe(50000000 - 5);
      }
    });

    it('should not apply replay window to txHash cursor', () => {
      const txHashCursor = {
        type: 'txHash' as const,
        value: '0xABC123',
      };
      const adjustedCursor = provider.applyReplayWindow(txHashCursor);

      // Should return same cursor unchanged
      expect(adjustedCursor).toEqual(txHashCursor);
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
    it('should deduplicate transactions across batches during replay', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      // Fetch first batch
      let firstBatchCursor: CursorState | undefined;
      let lastTxId: string | undefined;

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length > 0) {
          lastTxId = batch.cursor.lastTransactionId;
          firstBatchCursor = batch.cursor;
          break;
        }
      }

      // Skip if no transactions
      if (!firstBatchCursor || !lastTxId) {
        console.log('Test address has no transactions, skipping test');
        return;
      }

      expect(firstBatchCursor).toBeDefined();
      expect(lastTxId).toBeDefined();

      // Simulate cross-provider resume with replay window
      const blockCursor = firstBatchCursor.alternatives?.find((c) => c.type === 'blockNumber');
      if (!blockCursor || blockCursor.type !== 'blockNumber') {
        console.log('No blockNumber cursor available, skipping test');
        return;
      }

      const crossProviderCursor: CursorState = {
        primary: blockCursor,
        alternatives: firstBatchCursor.alternatives || [],
        lastTransactionId: lastTxId,
        totalFetched: 0, // Reset for cross-provider
        metadata: {
          providerName: 'different-provider', // Different provider to trigger replay
          updatedAt: Date.now(),
          isComplete: false,
        },
      };

      // Resume with cross-provider cursor - should apply replay window and deduplicate
      let hasLastTransaction = false;
      for await (const result of provider.executeStreaming<CosmosTransaction>(operation, crossProviderCursor)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length > 0) {
          // Check if the lastTransactionId from first batch appears in second batch
          for (const tx of batch.data) {
            if (tx.normalized.id === lastTxId) {
              hasLastTransaction = true;
              break;
            }
          }
          break;
        }
      }

      // At minimum, the last transaction should be deduped
      expect(hasLastTransaction).toBe(false);
    }, 60000);

    it('should not yield empty batches after deduplication', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      let batchCount = 0;
      const maxBatches = 1; // Only 1 batch to minimize API usage

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;

        // Every yielded batch should have data
        // (empty batches after deduplication should not be yielded)
        if (batch.data.length === 0) {
          // Only the last batch (when complete) is allowed to be empty
          expect(batch.isComplete).toBe(true);
        }

        batchCount++;
        if (batchCount >= maxBatches) break;
      }

      // If no transactions, skip
      if (batchCount === 0) {
        console.log('Test address has no transactions, skipping test');
      } else {
        expect(batchCount).toBeGreaterThan(0);
      }
    }, 60000);
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

    it('should handle API errors gracefully in streaming', async () => {
      const invalidAddress = 'invalid-injective-address';

      const operation = {
        type: 'getAddressTransactions' as const,
        address: invalidAddress,
        transactionType: 'normal' as const,
      };

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        // Should return an error result rather than throwing
        if (result.isErr()) {
          expect(result.error).toBeDefined();
          expect(result.error.message).toBeTruthy();
        }
        break;
      }
    }, 30000);
  });

  describe('Cosmos-specific streaming', () => {
    it('should stream Cosmos transactions with message metadata', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length > 0) {
          const firstTx = batch.data[0]!.normalized;

          // Cosmos transactions have message metadata
          expect(firstTx).toHaveProperty('messageType');
          expect(firstTx).toHaveProperty('from');
          expect(firstTx).toHaveProperty('to');
          expect(firstTx).toHaveProperty('amount');
          expect(firstTx).toHaveProperty('currency');

          // Verify message type exists
          if (firstTx.messageType) {
            expect(typeof firstTx.messageType).toBe('string');
          }

          // Injective currency for fees
          expect(firstTx.feeCurrency).toBe('INJ');
        }
        break; // Only need first batch
      }
    }, 60000);

    it('should include fee information', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        transactionType: 'normal' as const,
      };

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length > 0) {
          const firstTx = batch.data[0]!.normalized;

          // Verify fee structure
          expect(firstTx.feeAmount).toBeDefined();
          expect(typeof firstTx.feeAmount).toBe('string');
          expect(firstTx.feeCurrency).toBe('INJ');
        }
        break; // Only need first batch
      }
    }, 60000);
  });
});
