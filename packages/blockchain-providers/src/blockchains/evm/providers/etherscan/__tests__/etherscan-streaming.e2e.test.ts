import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { OneShotOperation, StreamingBatchResult } from '../../../../../core/types/index.js';
import type { EvmTransaction } from '../../../types.js';
import { EtherscanApiClient } from '../etherscan.api-client.js';

describe('EtherscanApiClient Streaming E2E', () => {
  describe('Ethereum Beacon Withdrawals Streaming', () => {
    const config = ProviderRegistry.createDefaultConfig('ethereum', 'etherscan');
    const provider = new EtherscanApiClient(config);

    // Known address with beacon chain withdrawals (staking pool contract)
    // This address receives validator withdrawals and has a good number of them for testing
    const testAddress = '0x51b4096d4bde1b883f6d6ca3b1b7eb54dc20b913';

    describe('streamAddressBeaconWithdrawals via executeStreaming', () => {
      it('should stream beacon withdrawals and fetch at least 25 records in first batch', async () => {
        const batches: StreamingBatchResult<EvmTransaction>[] = [];
        let totalRecords = 0;
        const maxBatches = 1; // Only fetch 1 batch to minimize API usage

        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          if (result.isErr()) {
            console.error('Streaming error:', result.error);
            console.error('Error message:', result.error.message);
            console.error('Error stack:', result.error.stack);
          }
          expect(result.isOk()).toBe(true);
          if (result.isErr()) {
            break;
          }

          const batch = result.value;
          batches.push(batch);
          totalRecords += batch.data.length;

          // Verify batch structure
          expect(batch).toHaveProperty('data');
          expect(batch).toHaveProperty('cursor');
          expect(Array.isArray(batch.data)).toBe(true);

          console.log(`Fetched batch with ${batch.data.length} withdrawals`);

          // Verify withdrawals in batch
          if (batch.data.length > 0) {
            const firstWithdrawal = batch.data[0]!;
            expect(firstWithdrawal).toHaveProperty('raw');
            expect(firstWithdrawal).toHaveProperty('normalized');

            const normalized = firstWithdrawal.normalized;
            expect(normalized).toHaveProperty('id');
            expect(normalized.id).toMatch(/^beacon-withdrawal-\d+$/);
            expect(normalized.type).toBe('beacon_withdrawal');
            expect(normalized.from).toBe('0x0000000000000000000000000000000000000000');
            expect(normalized.to?.toLowerCase()).toBe(testAddress.toLowerCase());
            expect(normalized.status).toBe('success');
            expect(normalized.feeAmount).toBe('0');
            expect(normalized.gasUsed).toBe('0');
            expect(normalized.currency).toBe('ETH');
            expect(normalized.providerName).toBe('etherscan');
            expect(normalized.tokenType).toBe('native');
            expect(normalized).toHaveProperty('blockHeight');
            expect(normalized.blockHeight).toBeGreaterThan(0);
            expect(normalized).toHaveProperty('timestamp');
            expect(normalized.timestamp).toBeGreaterThan(0);

            // Verify amount is in Wei (converted from Gwei)
            expect(normalized.amount).toBeDefined();
            expect(typeof normalized.amount).toBe('string');
            expect(normalized.amount).toMatch(/^\d+$/);

            // Log sample withdrawal for debugging
            console.log('Sample withdrawal:', {
              id: normalized.id,
              amount: normalized.amount,
              blockHeight: normalized.blockHeight,
              timestamp: new Date(normalized.timestamp).toISOString(),
            });
          }

          // Verify cursor state structure
          expect(batch.cursor).toHaveProperty('primary');
          expect(batch.cursor).toHaveProperty('alternatives');
          expect(batch.cursor).toHaveProperty('lastTransactionId');
          expect(batch.cursor).toHaveProperty('totalFetched');
          expect(batch.cursor).toHaveProperty('metadata');

          // Verify cursor metadata
          expect(batch.cursor.metadata?.providerName).toBe('etherscan');
          expect(batch.cursor.metadata?.updatedAt).toBeGreaterThan(0);
          expect(typeof batch.isComplete).toBe('boolean');

          // Limit test to avoid API credit usage
          if (batches.length >= maxBatches) {
            break;
          }
        }

        // Verify we got data
        expect(batches.length).toBeGreaterThan(0);
        expect(totalRecords).toBeGreaterThan(0);

        // This address should have at least 25 withdrawals in the first page
        // (page size is 1000 records due to Etherscan V2 pagination limits)
        expect(totalRecords).toBeGreaterThanOrEqual(25);

        console.log(`Total withdrawals fetched: ${totalRecords}`);
      }, 60000);

      it('should extract blockNumber and timestamp cursors from withdrawals', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length === 0) continue;

          // Verify cursor extraction
          const cursor = batch.cursor;

          // Should have alternatives containing blockNumber
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

          // Primary cursor should be pageToken for Etherscan (page-based pagination)
          expect(cursor.primary.type).toBe('pageToken');
          if (cursor.primary.type === 'pageToken') {
            expect(cursor.primary.providerName).toBe('etherscan');
            expect(typeof cursor.primary.value).toBe('string');
            // Page token should be a page number (as string)
            expect(parseInt(cursor.primary.value)).toBeGreaterThan(0);
          }

          // Only need to verify first batch
          break;
        }
      }, 60000);

      it('should track totalFetched across batches', async () => {
        let previousTotal = 0;
        let batchCount = 0;
        const maxBatches = 2; // Fetch 2 batches to test pagination

        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          if (result.isErr()) {
            console.error('[totalFetched test] Error:', result.error.message);
          }
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length === 0) {
            // If no data, we've reached the end
            break;
          }

          const currentTotal = batch.cursor.totalFetched;

          // Total should increase with each batch
          if (batchCount > 0) {
            expect(currentTotal).toBeGreaterThan(previousTotal);
          }

          // Total should equal previous total plus current batch size
          const expectedTotal = previousTotal + batch.data.length;
          expect(currentTotal).toBe(expectedTotal);

          console.log(`Batch ${batchCount + 1}: ${batch.data.length} withdrawals, total: ${currentTotal}`);

          previousTotal = currentTotal;
          batchCount++;

          if (batchCount >= maxBatches) break;
        }

        expect(batchCount).toBeGreaterThan(0);
        console.log(`Total batches fetched: ${batchCount}, total withdrawals: ${previousTotal}`);
      }, 120000);

      it('should resume from cursor state (blockNumber)', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
          address: testAddress,
        };

        // Fetch first batch
        let firstBatchCursor: CursorState | undefined;
        let firstBatchLastTx: string | undefined;
        let firstBatchCount = 0;

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          if (result.isErr()) {
            console.error('[resume test - first batch] Error:', result.error.message);
          }
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            firstBatchCursor = batch.cursor;
            firstBatchLastTx = batch.cursor.lastTransactionId;
            firstBatchCount = batch.data.length;
            break;
          }
        }

        expect(firstBatchCursor).toBeDefined();
        expect(firstBatchLastTx).toBeDefined();
        console.log(`First batch: ${firstBatchCount} withdrawals, last tx: ${firstBatchLastTx}`);

        // Resume from cursor
        let resumedBatchFirstTx: string | undefined;
        let resumedBatchCount = 0;

        console.log('[resume test] Resuming with cursor:', JSON.stringify(firstBatchCursor, undefined, 2));

        for await (const result of provider.executeStreaming<EvmTransaction>(operation, firstBatchCursor)) {
          if (result.isErr()) {
            console.error('[resume test - resumed batch] Error:', result.error.message);
          }
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length > 0) {
            resumedBatchFirstTx = batch.data[0]!.normalized.id;
            resumedBatchCount = batch.data.length;
            break;
          }
        }

        console.log(`Resumed batch: ${resumedBatchCount} withdrawals, first tx: ${resumedBatchFirstTx}`);

        // Verify resume actually advanced: first tx of resumed batch should be different
        expect(resumedBatchFirstTx).toBeDefined();
        expect(resumedBatchFirstTx).not.toBe(firstBatchLastTx);
      }, 120000);

      it('should handle pagination with pages correctly', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
          address: testAddress,
        };

        const batches: { blockRange: string; count: number; page: number }[] = [];
        let batchCount = 0;
        const maxBatches = 3; // Fetch multiple batches to test page-based pagination

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;

          if (batch.data.length > 0) {
            const firstBlock = batch.data[0]!.normalized.blockHeight;
            const lastBlock = batch.data[batch.data.length - 1]!.normalized.blockHeight;

            // Extract page number from cursor (pageToken should be page number)
            const pageToken = batch.cursor.primary.type === 'pageToken' ? batch.cursor.primary.value : 'unknown';

            batches.push({
              page: batchCount + 1, // Pages are 1-indexed
              blockRange: `${firstBlock}-${lastBlock}`,
              count: batch.data.length,
            });

            console.log(
              `Page ${batchCount + 1}: blocks ${firstBlock}-${lastBlock}, ${batch.data.length} withdrawals, next page token: ${pageToken}`
            );
          }

          batchCount++;

          if (batch.isComplete || batchCount >= maxBatches) {
            break;
          }
        }

        // Verify we got at least one batch
        expect(batches.length).toBeGreaterThan(0);

        // Verify block numbers are increasing across pages (withdrawals should be in chronological order)
        if (batches.length > 1) {
          for (let i = 1; i < batches.length; i++) {
            const prevLastBlock = parseInt(batches[i - 1]!.blockRange.split('-')[1]!);
            const currFirstBlock = parseInt(batches[i]!.blockRange.split('-')[0]!);

            // Current batch should start at or after previous batch's last block
            expect(currFirstBlock).toBeGreaterThanOrEqual(prevLastBlock);
          }
        }

        console.log('Pages fetched:', batches);
      }, 180000);

      it('should apply replay window to blockNumber cursor', () => {
        const blockNumberCursor = { type: 'blockNumber' as const, value: 18000000 };
        const adjustedCursor = provider.applyReplayWindow(blockNumberCursor);

        expect(adjustedCursor.type).toBe('blockNumber');
        if (adjustedCursor.type === 'blockNumber') {
          // Replay window is 2 blocks for Etherscan
          expect(adjustedCursor.value).toBe(18000000 - 2);
        }
      });

      it('should handle zero block edge case in replay window', () => {
        const blockNumberCursor = { type: 'blockNumber' as const, value: 1 };
        const adjustedCursor = provider.applyReplayWindow(blockNumberCursor);

        expect(adjustedCursor.type).toBe('blockNumber');
        if (adjustedCursor.type === 'blockNumber') {
          // Should not go below 0
          expect(adjustedCursor.value).toBe(0);
          expect(adjustedCursor.value).toBeGreaterThanOrEqual(0);
        }
      });

      it('should mark isComplete when all withdrawals fetched', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
          address: testAddress,
        };

        let lastBatch: StreamingBatchResult<EvmTransaction> | undefined;
        let batchCount = 0;

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          if (result.isErr()) {
            console.error(`[isComplete test - batch ${batchCount + 1}] Error:`, result.error.message);
          }
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          lastBatch = result.value;
          batchCount++;

          // Don't fetch forever - stop after 10 batches for this test
          if (batchCount >= 10) {
            console.log('Stopping after 10 batches to avoid excessive API usage');
            break;
          }
        }

        console.log(`Total batches processed: ${batchCount}`);

        if (lastBatch) {
          // If we got an empty batch or isComplete is true, we're done
          if (lastBatch.data.length === 0 || lastBatch.isComplete) {
            expect(lastBatch.isComplete).toBe(true);
            console.log('Streaming completed - all withdrawals fetched');
          } else {
            console.log('Streaming interrupted at batch limit - more data may be available');
          }
        }
      }, 180000);

      it('should handle address with no withdrawals gracefully', async () => {
        // Regular EOA address that likely has no beacon withdrawals
        const addressWithoutWithdrawals = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4';

        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
          address: addressWithoutWithdrawals,
        };

        let batchCount = 0;
        let totalRecords = 0;

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          if (result.isErr()) {
            console.error('[no withdrawals test] Error:', result.error.message);
          }
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          batchCount++;
          totalRecords += batch.data.length;

          // Should complete with empty results
          if (batch.data.length === 0) {
            expect(batch.isComplete).toBe(true);
            break;
          }
        }

        console.log(`Address with no withdrawals: ${batchCount} batches, ${totalRecords} records`);

        // Should complete successfully with 0 or very few withdrawals
        // When there are truly no withdrawals, streaming completes without yielding batches (batchCount = 0)
        expect(batchCount).toBeGreaterThanOrEqual(0);
        expect(totalRecords).toBe(0);
      }, 60000);
    });

    describe('Cursor extraction and replay window', () => {
      it('should extract blockNumber and timestamp cursors from withdrawals', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
          address: testAddress,
        };

        for await (const result of provider.executeStreaming<EvmTransaction>(operation)) {
          expect(result.isOk()).toBe(true);
          if (result.isErr()) break;

          const batch = result.value;
          if (batch.data.length === 0) continue;

          // Test cursor extraction on first withdrawal
          const firstWithdrawal = batch.data[0]!.normalized;
          const cursors = provider.extractCursors(firstWithdrawal);

          expect(Array.isArray(cursors)).toBe(true);
          expect(cursors.length).toBeGreaterThan(0);

          // Should extract blockNumber cursor
          const blockNumberCursor = cursors.find((c) => c.type === 'blockNumber');
          expect(blockNumberCursor).toBeDefined();
          if (blockNumberCursor && blockNumberCursor.type === 'blockNumber') {
            expect(typeof blockNumberCursor.value).toBe('number');
            expect(blockNumberCursor.value).toBe(firstWithdrawal.blockHeight);
          }

          // Should extract timestamp cursor
          const timestampCursor = cursors.find((c) => c.type === 'timestamp');
          expect(timestampCursor).toBeDefined();
          if (timestampCursor && timestampCursor.type === 'timestamp') {
            expect(typeof timestampCursor.value).toBe('number');
            expect(timestampCursor.value).toBe(firstWithdrawal.timestamp);
          }

          break;
        }
      }, 60000);
    });

    describe('Error handling', () => {
      it('should return error for non-streaming execute() call', async () => {
        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
          address: testAddress,
        };

        const result = await provider.execute(operation as unknown as OneShotOperation);
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('only supports streaming');
        }
      });

      it('should return error for unsupported streaming operation', async () => {
        const operation = {
          type: 'getAddressTransactions' as const, // Not supported by Etherscan provider
          address: testAddress,
          streamType: 'normal' as const,
        };

        for await (const result of provider.executeStreaming(operation)) {
          expect(result.isErr()).toBe(true);
          if (result.isErr()) {
            expect(result.error.message).toContain('Streaming not supported');
          }
          break;
        }
      });

      it('should handle API errors gracefully', async () => {
        const invalidAddress = 'not-an-address';

        const operation = {
          type: 'getAddressTransactions' as const,
          streamType: 'beacon_withdrawal' as const,
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
});
