import type { CursorState } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import { ProviderRegistry } from '../../../../../core/index.js';
import type { NearBalanceChange, NearReceipt, NearTokenTransfer, NearTransaction } from '../../../schemas.js';
import { NearBlocksApiClient } from '../nearblocks.api-client.js';

describe.sequential('NearBlocksApiClient Streaming E2E', () => {
  const config = ProviderRegistry.createDefaultConfig('near', 'nearblocks');
  const client = new NearBlocksApiClient(config);
  // NEAR Foundation address - well-known address with transaction history
  const testAddress = 'nearkat.near';

  describe('streamAddressTransactions - transactions type', () => {
    it('should stream transactions with cursor management', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        streamType: 'transactions' as const,
      };
      const stream = client.executeStreaming<NearTransaction>(operation);

      let batchCount = 0;
      let totalTransactions = 0;
      let lastCursor: CursorState | undefined;
      const maxBatches = 2; // Limit for testing - minimize API calls

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
        expect(batch.cursor.metadata?.providerName).toBe('nearblocks');
        expect(typeof batch.cursor.metadata?.updatedAt).toBe('number');
        expect(typeof batch.isComplete).toBe('boolean');

        // Verify primary cursor is pageToken
        if (batch.cursor.primary.type === 'pageToken') {
          expect(batch.cursor.primary.providerName).toBe('nearblocks');
          expect(typeof batch.cursor.primary.value).toBe('string');
        }

        // Verify each transaction
        for (const txData of batch.data) {
          expect(txData).toHaveProperty('normalized');
          expect(txData).toHaveProperty('raw');

          const tx = txData.normalized;
          expect(tx.streamType).toBe('transactions');
          expect(typeof tx.id).toBe('string');
          expect(typeof tx.transactionHash).toBe('string');
          expect(typeof tx.signerAccountId).toBe('string');
          expect(typeof tx.receiverAccountId).toBe('string');
          expect(typeof tx.timestamp).toBe('number');
          expect(typeof tx.blockHeight).toBe('number');
          expect(typeof tx.status).toBe('boolean');
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

    it('should resume streaming from cursor', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        streamType: 'transactions' as const,
      };

      // First stream: get first batch and cursor
      const stream1 = client.executeStreaming<NearTransaction>(operation);
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
      const stream2 = client.executeStreaming<NearTransaction>(operation, resumeCursor);
      const secondBatchResult = await stream2.next();

      expect(secondBatchResult.done).toBe(false);
      if (secondBatchResult.done || !secondBatchResult.value) return;

      const secondBatchValue = secondBatchResult.value;
      if (secondBatchValue.isErr()) return;

      const secondBatch = secondBatchValue.value;

      // Verify we got different transactions
      const firstIds = new Set(firstBatch.data.map((tx) => tx.normalized.id));
      const secondIds = new Set(secondBatch.data.map((tx) => tx.normalized.id));

      // Should have no overlap with pageToken-based pagination
      const overlap = Array.from(firstIds).filter((id) => secondIds.has(id)).length;
      expect(overlap).toBe(0);
    }, 60000);

    it('should handle pagination correctly', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        streamType: 'transactions' as const,
      };
      const stream = client.executeStreaming<NearTransaction>(operation);

      const seenTransactionIds = new Set<string>();
      let batchCount = 0;
      const maxBatches = 2;

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
    }, 60000);
  });

  describe('streamAddressTransactions - receipts type', () => {
    it('should stream receipts successfully', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        streamType: 'receipts' as const,
      };
      const stream = client.executeStreaming<NearReceipt>(operation);

      let batchCount = 0;
      let totalReceipts = 0;
      const maxBatches = 2; // Limit for testing

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        batchCount++;
        totalReceipts += batch.data.length;

        // Verify each receipt
        for (const receiptData of batch.data) {
          const receipt = receiptData.normalized;
          expect(receipt.streamType).toBe('receipts');
          expect(typeof receipt.receiptId).toBe('string');
          expect(typeof receipt.transactionHash).toBe('string');
          expect(typeof receipt.predecessorAccountId).toBe('string');
          expect(typeof receipt.receiverAccountId).toBe('string');
          expect(typeof receipt.timestamp).toBe('number');
          expect(typeof receipt.blockHeight).toBe('number');
        }

        if (batchCount >= maxBatches || batch.isComplete) {
          break;
        }
      }

      expect(batchCount).toBeGreaterThan(0);
      expect(totalReceipts).toBeGreaterThan(0);
    }, 60000);
  });

  describe('streamAddressTransactions - balance-changes type', () => {
    it('should stream balance changes successfully', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        streamType: 'balance-changes' as const,
      };
      const stream = client.executeStreaming<NearBalanceChange>(operation);

      let batchCount = 0;
      let totalBalanceChanges = 0;
      const maxBatches = 2; // Limit for testing

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        batchCount++;
        totalBalanceChanges += batch.data.length;

        // Verify each balance change
        for (const balanceChangeData of batch.data) {
          const balanceChange = balanceChangeData.normalized;
          expect(balanceChange.streamType).toBe('balance-changes');
          expect(typeof balanceChange.affectedAccountId).toBe('string');
          expect(['INBOUND', 'OUTBOUND']).toContain(balanceChange.direction);
          expect(typeof balanceChange.timestamp).toBe('number');
          expect(typeof balanceChange.cause).toBe('string');

          // Event ID should follow the pattern
          expect(balanceChange.eventId).toMatch(/^balance-changes:[a-f0-9]{64}$/);
        }

        if (batchCount >= maxBatches || batch.isComplete) {
          break;
        }
      }

      expect(batchCount).toBeGreaterThan(0);
      expect(totalBalanceChanges).toBeGreaterThan(0);
    }, 60000);
  });

  describe('streamAddressTransactions - token-transfers type', () => {
    it('should stream token transfers successfully', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        streamType: 'token-transfers' as const,
      };
      const stream = client.executeStreaming<NearTokenTransfer>(operation);

      let batchCount = 0;
      const maxBatches = 2; // Limit for testing

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        batchCount++;

        // Verify each token transfer
        for (const tokenTransferData of batch.data) {
          const tokenTransfer = tokenTransferData.normalized;
          expect(tokenTransfer.streamType).toBe('token-transfers');
          expect(typeof tokenTransfer.transactionHash).toBe('string');
          expect(typeof tokenTransfer.affectedAccountId).toBe('string');
          expect(typeof tokenTransfer.contractAddress).toBe('string');
          expect(typeof tokenTransfer.timestamp).toBe('number');
          expect(typeof tokenTransfer.blockHeight).toBe('number');

          // Event ID should follow the pattern
          expect(tokenTransfer.eventId).toMatch(/^token-transfers:/);
        }

        if (batchCount >= maxBatches || batch.isComplete) {
          break;
        }
      }

      expect(batchCount).toBeGreaterThan(0);
      // Token transfers might be empty for this address, so we don't assert count
    }, 60000);
  });

  describe('Cursor Extraction and Replay Window', () => {
    it('should extract correct cursor types from transactions', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        streamType: 'transactions' as const,
      };
      const stream = client.executeStreaming<NearTransaction>(operation);

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;

        if (batch.data.length > 0) {
          const tx = batch.data[0]!.normalized;
          const cursors = client.extractCursors(tx);

          expect(Array.isArray(cursors)).toBe(true);
          expect(cursors.length).toBeGreaterThan(0);

          // Should have timestamp and blockNumber cursors
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

    it('should apply replay window of 3 blocks to blockNumber cursor', () => {
      const blockCursor = { type: 'blockNumber' as const, value: 100000 };
      const replayedBlockCursor = client.applyReplayWindow(blockCursor);

      expect(replayedBlockCursor.type).toBe('blockNumber');
      expect(replayedBlockCursor.value).toBe(99997); // 100000 - 3

      // Should not go below zero
      const lowBlockCursor = { type: 'blockNumber' as const, value: 2 };
      const replayedLowBlockCursor = client.applyReplayWindow(lowBlockCursor);

      expect(replayedLowBlockCursor.type).toBe('blockNumber');
      expect(replayedLowBlockCursor.value).toBe(0);
    });

    it('should not apply replay window to timestamp cursor', () => {
      const timestampCursor = { type: 'timestamp' as const, value: 1640000000000 };
      const replayedTimestampCursor = client.applyReplayWindow(timestampCursor);

      expect(replayedTimestampCursor.type).toBe('timestamp');
      expect(replayedTimestampCursor.value).toBe(1640000000000); // Unchanged
    });
  });

  describe('Transaction Data Quality', () => {
    it('should include all required fields in streamed transactions', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
        streamType: 'transactions' as const,
      };
      const stream = client.executeStreaming<NearTransaction>(operation);

      for await (const result of stream) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;

        if (batch.data.length > 0) {
          const txData = batch.data[0]!;
          const tx = txData.normalized;

          // Required fields
          expect(tx.id).toBeDefined();
          expect(tx.transactionHash).toBeDefined();
          expect(tx.signerAccountId).toBeDefined();
          expect(tx.receiverAccountId).toBeDefined();
          expect(tx.timestamp).toBeDefined();
          expect(tx.blockHeight).toBeDefined();
          expect(tx.streamType).toBe('transactions');

          // Event ID should equal transaction hash for transactions
          expect(tx.eventId).toBe(tx.transactionHash);

          break;
        }
      }
    }, 30000);
  });
});
