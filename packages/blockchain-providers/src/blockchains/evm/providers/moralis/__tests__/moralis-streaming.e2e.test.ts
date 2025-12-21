import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { StreamingBatchResult } from '../../../../../core/types/index.js';
import type { EvmTransaction } from '../../../types.js';
import { MoralisApiClient } from '../moralis.api-client.js';

describe('MoralisApiClient Streaming E2E', () => {
  describe('Ethereum Streaming', () => {
    const config = ProviderRegistry.createDefaultConfig('ethereum', 'moralis');
    const provider = new MoralisApiClient(config);
    // Address with moderate transaction volume for testing (to minimize API credits usage)
    const testAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4';

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
            expect(firstTx.normalized.providerName).toBe('moralis');
            expect(firstTx.normalized.currency).toBe('ETH');
          }

          // Verify cursor state structure
          expect(batch.cursor).toHaveProperty('primary');
          expect(batch.cursor).toHaveProperty('alternatives');
          expect(batch.cursor).toHaveProperty('lastTransactionId');
          expect(batch.cursor).toHaveProperty('totalFetched');
          expect(batch.cursor).toHaveProperty('metadata');

          // Verify cursor metadata
          expect(batch.cursor.metadata?.providerName).toBe('moralis');
          expect(batch.cursor.metadata?.updatedAt).toBeGreaterThan(0);
          expect(typeof batch.isComplete).toBe('boolean');

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

          // Primary cursor should be pageToken for Moralis
          expect(cursor.primary.type).toBe('pageToken');
          if (cursor.primary.type === 'pageToken') {
            expect(cursor.primary.providerName).toBe('moralis');
            expect(typeof cursor.primary.value).toBe('string');
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
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
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

      it('should handle deduplication during cross-provider resume', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        // Fetch first batch and get its cursor
        let firstBatchCursor: CursorState | undefined;
        const firstBatchTransactionIds = new Set<string>();

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            // Store all transaction IDs from first batch
            for (const tx of batch.data) {
              firstBatchTransactionIds.add(tx.normalized.id);
            }
            firstBatchCursor = batch.cursor;
            break;
          }
        }

        // Skip test if no transactions found
        if (!firstBatchCursor || firstBatchTransactionIds.size === 0) {
          console.log('Test address has no transactions, skipping test');
          return;
        }

        expect(firstBatchCursor).toBeDefined();
        expect(firstBatchTransactionIds.size).toBeGreaterThan(0);

        // Create a cross-provider cursor (simulating failover from blockNumber)
        const crossProviderCursor: CursorState = {
          primary: firstBatchCursor.alternatives?.find((c) => c.type === 'blockNumber') || {
            type: 'blockNumber',
            value: 0,
          },
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
        let foundDuplicates = false;
        for await (const result of provider.executeStreaming<EvmTransaction>(operation, crossProviderCursor)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            // Check if any transactions from first batch leaked into resumed batch
            // If deduplication is working, NO duplicates should appear in the output
            for (const tx of batch.data) {
              if (firstBatchTransactionIds.has(tx.normalized.id)) {
                foundDuplicates = true;
                break;
              }
            }
            break;
          }
        }

        // Deduplication MUST prevent duplicates from appearing in output
        // Even though replay window fetches overlapping data, dedup should filter it out
        expect(foundDuplicates).toBe(false);
      }, 60000);

      it('should mark isComplete when no more data available', async () => {
        // Use an address with very few transactions to reach completion quickly
        const smallAddress = '0x0000000000000000000000000000000000000001';

        const operation = {
          type: 'getAddressTransactions' as const,
          address: smallAddress,
        };

        let lastBatch: StreamingBatchResult<EvmTransaction> | undefined;
        let hadError = false;

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          if (result.isErr()) {
            hadError = true;
            break;
          }

          lastBatch = result.value;
        }

        // Skip if API returned error (some providers may not support zero address)
        if (hadError) {
          console.log('API error for zero address, skipping test');
          return;
        }

        if (lastBatch) {
          // Last batch should be marked as complete
          expect(lastBatch.isComplete).toBe(true);
        }
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

          // Verify token transactions in batch
          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!;
            expect(firstTx).toHaveProperty('raw');
            expect(firstTx).toHaveProperty('normalized');
            expect(firstTx.normalized).toHaveProperty('id');
            expect(firstTx.normalized.type).toBe('token_transfer');
            expect(firstTx.normalized).toHaveProperty('tokenAddress');
            expect(firstTx.normalized).toHaveProperty('tokenDecimals');
            expect(firstTx.normalized.providerName).toBe('moralis');
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

      it('should filter by contract address', async () => {
        // USDC on Ethereum
        const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

        const operation = {
          type: 'getAddressTokenTransactions' as const,
          address: testAddress,
          contractAddress: usdcAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            // All transactions should be for the specified token
            for (const tx of batch.data) {
              expect(tx.normalized.tokenAddress?.toLowerCase()).toBe(usdcAddress.toLowerCase());
            }
            break; // Only need to verify first batch
          }
        }
      }, 60000);

      it('should resume token transaction streaming from cursor', async () => {
        const operation = {
          type: 'getAddressTokenTransactions' as const,
          address: testAddress,
        };

        // Fetch first batch
        let firstBatchCursor: CursorState | undefined;
        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            firstBatchCursor = batch.cursor;
            break;
          }
        }

        // Skip if no token transactions
        if (!firstBatchCursor) {
          console.log('Test address has no token transactions, skipping test');
          return;
        }

        expect(firstBatchCursor).toBeDefined();

        // Resume from cursor
        for await (const result of provider.executeStreaming<EvmTransaction>(operation, firstBatchCursor)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          // Verify we got data (may be empty if first batch was last)
          expect(Array.isArray(batch.data)).toBe(true);

          // If we got data, verify structure
          if (batch.data.length > 0) {
            const firstTx = batch.data[0]!;
            expect(firstTx.normalized.type).toBe('token_transfer');
            expect(firstTx.normalized.providerName).toBe('moralis');
          }
          break;
        }
      }, 60000);

      it('should extract cursors for token transactions', async () => {
        const operation = {
          type: 'getAddressTokenTransactions' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length === 0) continue;

          const cursor = batch.cursor;

          // Should have blockNumber cursor
          const blockNumberCursor = cursor.alternatives?.find((c) => c.type === 'blockNumber');
          expect(blockNumberCursor).toBeDefined();

          if (blockNumberCursor && blockNumberCursor.type === 'blockNumber') {
            expect(typeof blockNumberCursor.value).toBe('number');
            expect(blockNumberCursor.value).toBeGreaterThan(0);
          }

          // Should have lastTransactionId
          expect(cursor.lastTransactionId).toBeDefined();
          expect(typeof cursor.lastTransactionId).toBe('string');
          expect(cursor.lastTransactionId.length).toBeGreaterThan(0);

          break;
        }
      }, 60000);
    });

    describe('streamAddressInternalTransactions via executeStreaming', () => {
      it('should yield empty completion batch for internal transactions', async () => {
        const operation = {
          type: 'getAddressInternalTransactions' as const,
          address: testAddress,
        };

        let batchCount = 0;
        let lastBatch: StreamingBatchResult<EvmTransaction> | undefined;

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) {
            console.error('Streaming error:', result.error.message);
            break;
          }

          const batch = result.value;
          lastBatch = batch;
          batchCount++;

          // Should yield exactly one empty batch
          expect(batch.data).toEqual([]);
          expect(batch.cursor).toBeDefined();

          // Verify cursor structure
          expect(batch.cursor).toHaveProperty('primary');
          expect(batch.cursor).toHaveProperty('lastTransactionId');
          expect(batch.cursor).toHaveProperty('totalFetched');
          expect(batch.cursor).toHaveProperty('metadata');

          // Verify synthetic cursor values
          expect(batch.cursor.primary.type).toBe('blockNumber');
          if (batch.cursor.primary.type === 'blockNumber') {
            expect(batch.cursor.primary.value).toBe(0);
          }
          expect(batch.cursor.lastTransactionId).toContain('internal:empty');
          expect(batch.cursor.totalFetched).toBe(0);

          // Verify completion metadata
          expect(batch.cursor.metadata?.providerName).toBe('moralis');
          expect(batch.isComplete).toBe(true);
          expect(batch.cursor.metadata?.updatedAt).toBeGreaterThan(0);
        }

        // Should yield exactly one batch
        expect(batchCount).toBe(1);
        expect(lastBatch).toBeDefined();
        expect(lastBatch?.cursor.metadata?.isComplete).toBe(true);
      }, 30000);

      it('should handle resume from internal transaction cursor', async () => {
        const operation = {
          type: 'getAddressInternalTransactions' as const,
          address: testAddress,
        };

        // Fetch first batch and get cursor
        let firstCursor: CursorState | undefined;
        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          firstCursor = batch.cursor;
          break;
        }

        expect(firstCursor).toBeDefined();

        // Resume from cursor - should yield same empty completion batch
        let resumedBatchCount = 0;
        for await (const result of provider.executeStreaming<EvmTransaction>(operation, firstCursor)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          resumedBatchCount++;

          // Should still yield empty batch with completion marker
          expect(batch.data).toEqual([]);
          expect(batch.isComplete).toBe(true);
        }

        // Should yield exactly one batch on resume
        expect(resumedBatchCount).toBe(1);
      }, 30000);
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
          // Replay window is 2 blocks for Moralis
          expect(adjustedCursor.value).toBe(15000000 - 2);
        }
      });

      it('should not apply replay window to pageToken cursor', () => {
        const pageTokenCursor = {
          type: 'pageToken' as const,
          value: 'abc123',
          providerName: 'moralis',
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

    describe('Deduplication behavior', () => {
      it('should deduplicate transactions across batches during replay', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        // Fetch first batch
        let firstBatchCursor: CursorState | undefined;
        const firstBatchTxIds = new Set<string>();

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            for (const tx of batch.data) {
              firstBatchTxIds.add(tx.normalized.id);
            }
            firstBatchCursor = batch.cursor;
            break;
          }
        }

        // Skip if no transactions
        if (!firstBatchCursor || firstBatchTxIds.size === 0) {
          console.log('Test address has no transactions, skipping test');
          return;
        }

        expect(firstBatchCursor).toBeDefined();
        expect(firstBatchTxIds.size).toBeGreaterThan(0);

        // Simulate cross-provider resume with replay window
        const blockCursor = firstBatchCursor.alternatives?.find((c) => c.type === 'blockNumber');
        expect(blockCursor).toBeDefined();

        if (blockCursor && blockCursor.type === 'blockNumber') {
          const crossProviderCursor: CursorState = {
            primary: blockCursor,
            alternatives: firstBatchCursor.alternatives || [],
            lastTransactionId: firstBatchCursor.lastTransactionId,
            totalFetched: 0, // Reset for cross-provider
            metadata: {
              providerName: 'alchemy', // Different provider to trigger replay
              updatedAt: Date.now(),
              isComplete: false,
            },
          };

          // Resume with cross-provider cursor - should apply replay window and deduplicate
          const secondBatchTxIds = new Set<string>();
          for await (const result of provider.executeStreaming<EvmTransaction>(operation, crossProviderCursor)) {
            expect(result.isOk()).toBe(true);
            if (result.isErr()) break;

            const batch = result.value;
            if (batch.data.length > 0) {
              for (const tx of batch.data) {
                secondBatchTxIds.add(tx.normalized.id);
              }
              break;
            }
          }

          // Due to replay window, some transactions may appear in both batches
          // but deduplication should ensure we don't see duplicates in the second batch
          const duplicateCount = Array.from(secondBatchTxIds).filter((id) => firstBatchTxIds.has(id)).length;

          // Verify deduplication actually worked - NO duplicates should leak through
          expect(duplicateCount).toBe(0);
          // All transactions in second batch should be unique (no duplicates within the batch itself)
          expect(secondBatchTxIds.size).toBeGreaterThan(0);
        }
      }, 60000);

      it('should not yield empty batches after deduplication', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          address: testAddress,
        };

        let batchCount = 0;
        const maxBatches = 1; // Only 1 batch to minimize API usage

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
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
        const invalidAddress = 'invalid-address';

        const operation = {
          type: 'getAddressTransactions' as const,
          address: invalidAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          // Should return an error result rather than throwing
          if (result.isErr()) {
            expect(result.error).toBeDefined();
            expect(result.error.message).toBeTruthy();
          }
          break;
        }
      }, 30000);
    });
  });

  describe('Multi-chain streaming', () => {
    it('should stream Avalanche transactions with correct currency', async () => {
      const config = ProviderRegistry.createDefaultConfig('avalanche', 'moralis');
      const provider = new MoralisApiClient(config);
      const testAddress = '0x70c68a08d8c1C1Fa1CD5E5533e85a77c4Ac07022';

      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
      };

      for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length > 0) {
          const firstTx = batch.data[0]!;
          expect(firstTx.normalized.currency).toBe('AVAX');
          expect(firstTx.normalized.providerName).toBe('moralis');
        }
        break; // Only need first batch
      }
    }, 60000);

    it('should stream Polygon transactions with correct currency', async () => {
      const config = ProviderRegistry.createDefaultConfig('polygon', 'moralis');
      const provider = new MoralisApiClient(config);
      const testAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4';

      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
      };

      for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length > 0) {
          const firstTx = batch.data[0]!;
          expect(firstTx.normalized.currency).toBe('MATIC');
          expect(firstTx.normalized.providerName).toBe('moralis');
        }
        break; // Only need first batch
      }
    }, 60000);
  });
});
