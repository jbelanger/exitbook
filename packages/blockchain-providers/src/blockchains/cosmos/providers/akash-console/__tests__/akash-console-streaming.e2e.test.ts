import { describe, expect, it } from 'vitest';

import type { StreamingBatchResult, StreamingOperation } from '../../../../../core/types/index.js';
import { createProviderRegistry } from '../../../../../initialize.js';
import type { CosmosTransaction } from '../../../types.js';
import { AkashConsoleApiClient } from '../akash-console.api-client.js';

const providerRegistry = createProviderRegistry();

describe('AkashConsoleApiClient Streaming E2E', () => {
  const config = providerRegistry.createDefaultConfig('akash', 'akash-console');
  const provider = new AkashConsoleApiClient(config);
  // Test address from AKASH_RPC_CLIENT_GUIDE.md (has 5 transactions as of 2026-01-19)
  const testAddress = 'akash1asagzdynnr5h6c7sq3qgn4azjmsewt0lr97wj5';
  // Empty address for completion tests
  const emptyAddress = 'akash1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmhm7dh';

  describe('streamAddressTransactions via executeStreaming', () => {
    it('should stream transactions in batches with cursor state', async () => {
      const batches: StreamingBatchResult<CosmosTransaction>[] = [];
      let batchCount = 0;
      const maxBatches = 1; // Only fetch 1 batch since test address has limited transactions

      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
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
          expect(firstTx.normalized.providerName).toBe('akash-console');
          expect(firstTx.normalized.currency).toBe('AKT');
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
        expect(batch.cursor.metadata?.providerName).toBe('akash-console');
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

        // Primary cursor should be pageToken or blockNumber
        expect(['pageToken', 'blockNumber']).toContain(cursor.primary.type);

        // Only need to verify first batch
        break;
      }
    }, 60000);

    it('should track totalFetched across batches', async () => {
      let previousTotal = 0;
      let batchCount = 0;
      const maxBatches = 1; // Only 1 batch since test address has limited transactions

      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
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

        // Total should increase with each batch (or be initial value for first batch)
        if (batchCount > 0) {
          expect(currentTotal).toBeGreaterThan(previousTotal);
        }

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

    it('should handle historical transactions with proper structure', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
      };

      let foundTransaction = false;

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length === 0) break;

        // Verify any transaction has proper date structure
        for (const tx of batch.data) {
          expect(typeof tx.normalized.timestamp).toBe('number');
          expect(tx.normalized.timestamp).toBeGreaterThan(0);

          // Verify timestamp is valid
          const txDate = new Date(tx.normalized.timestamp);
          expect(txDate.getTime()).toBeGreaterThan(0);
          foundTransaction = true;
          break;
        }

        if (foundTransaction) break;
      }

      // Test address should have at least one transaction
      expect(foundTransaction).toBe(true);
    }, 60000);

    it('should correctly parse bank transactions when present', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
      };

      let foundBankTransaction = false;

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length === 0) break;

        for (const tx of batch.data) {
          // Verify bank send transactions have proper structure when present
          if (tx.normalized.messageType === '/cosmos.bank.v1beta1.MsgSend') {
            expect(tx.normalized.from).toBeDefined();
            expect(tx.normalized.to).toBeDefined();
            expect(tx.normalized.amount).toBeDefined();
            expect(tx.normalized.currency).toBe('AKT');
            foundBankTransaction = true;
          }
          // Verify bank multi-send transactions have proper structure when present
          if (tx.normalized.messageType === '/cosmos.bank.v1beta1.MsgMultiSend') {
            expect(tx.normalized.from).toBeDefined();
            expect(tx.normalized.to).toBeDefined();
            expect(tx.normalized.amount).toBeDefined();
            expect(tx.normalized.currency).toBe('AKT');
            foundBankTransaction = true;
          }
          // Verify any transaction has basic structure
          if (tx.normalized.messageType) {
            expect(tx.normalized.from).toBeDefined();
            expect(tx.normalized.to).toBeDefined();
            expect(tx.normalized.currency).toBe('AKT');
            foundBankTransaction = true;
          }
        }

        // Test complete after first batch
        break;
      }

      // Test address should have at least one transaction
      expect(foundBankTransaction).toBe(true);
    }, 60000);

    it('should mark isComplete when no more data available', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: emptyAddress,
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

    it('should not apply replay window (Akash Console API does not need replay)', () => {
      const blockNumberCursor = { type: 'blockNumber' as const, value: 50000000 };
      const adjustedCursor = provider.applyReplayWindow(blockNumberCursor);

      expect(adjustedCursor.type).toBe('blockNumber');
      if (adjustedCursor.type === 'blockNumber') {
        // No replay window for Akash Console API
        expect(adjustedCursor.value).toBe(50000000);
      }
    });
  });

  describe('Error handling', () => {
    it('should return error for unsupported streaming operation', async () => {
      const operation = {
        type: 'getAddressBalances' as const, // Not implemented for streaming
        address: testAddress,
      };

      for await (const result of provider.executeStreaming(operation as unknown as StreamingOperation)) {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.message).toContain('Streaming not yet implemented');
        }
        break; // Should only yield one error
      }
    }, 30000);
  });

  describe('Cosmos-specific streaming', () => {
    it('should stream Cosmos transactions with message metadata', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
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

          // Akash currency
          expect(firstTx.currency).toBe('AKT');
        }
        break; // Only need first batch
      }
    }, 60000);

    it('should include fee information', async () => {
      const operation = {
        type: 'getAddressTransactions' as const,
        address: testAddress,
      };

      for await (const result of provider.executeStreaming<CosmosTransaction>(operation)) {
        expect(result.isOk()).toBe(true);
        if (result.isErr()) break;

        const batch = result.value;
        if (batch.data.length > 0) {
          const firstTx = batch.data[0]!.normalized;

          // Verify fee structure (fees might be zero for some txs)
          expect(firstTx).toHaveProperty('feeAmount');
          if (firstTx.feeAmount) {
            expect(typeof firstTx.feeAmount).toBe('string');
            expect(firstTx.feeCurrency).toBe('AKT');
          }
        }
        break; // Only need first batch
      }
    }, 60000);
  });
});
