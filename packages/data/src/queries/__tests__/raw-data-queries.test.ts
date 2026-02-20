/* eslint-disable unicorn/no-null -- needed for db */
import { createRawDataQueries, createTestDatabase, type KyselyDB, type RawDataQueries } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('RawDataQueries', () => {
  let db: KyselyDB;
  let queries: RawDataQueries;

  beforeEach(async () => {
    db = await createTestDatabase();
    queries = createRawDataQueries(db);

    // Create default user
    await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();

    // Create mock accounts
    await db
      .insertInto('accounts')
      .values([
        {
          id: 1,
          user_id: 1,
          account_type: 'exchange-api',
          source_name: 'kraken',
          identifier: 'test-api-key',
          provider_name: null,
          parent_account_id: null,
          last_cursor: null,
          last_balance_check_at: null,
          verification_metadata: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        },
        {
          id: 2,
          user_id: 1,
          account_type: 'blockchain',
          source_name: 'ethereum',
          identifier: '0x123',
          provider_name: null,
          parent_account_id: null,
          last_cursor: null,
          last_balance_check_at: null,
          verification_metadata: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        },
      ])
      .execute();

    // Create mock import sessions
    await db
      .insertInto('import_sessions')
      .values([
        {
          id: 1,
          account_id: 1,
          started_at: new Date().toISOString(),
          status: 'completed',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          transactions_imported: 0,
          transactions_skipped: 0,
        },
        {
          id: 2,
          account_id: 2,
          started_at: new Date().toISOString(),
          status: 'completed',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          transactions_imported: 0,
          transactions_skipped: 0,
        },
      ])
      .execute();

    // Create test raw data records
    for (let i = 1; i <= 5; i++) {
      await db
        .insertInto('raw_transactions')
        .values({
          account_id: i <= 3 ? 1 : 2, // First 3 from kraken, last 2 from ethereum
          provider_name: i <= 3 ? 'kraken' : 'ethereum',
          event_id: `ext-${i}`,
          blockchain_transaction_hash: null,
          source_address: null,
          transaction_type_hint: null,
          provider_data: JSON.stringify({ id: `ext-${i}`, amount: '100.00' }),
          normalized_data: '{}',
          processing_status: i % 2 === 0 ? 'processed' : 'pending',
          processed_at: i % 2 === 0 ? new Date().toISOString() : undefined,
          created_at: new Date().toISOString(),
          timestamp: Date.now(),
        })
        .execute();
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('resetProcessingStatusByAccount', () => {
    it('should reset processing status for records from a specific account', async () => {
      // Verify initial state - some records are processed
      const initialProcessed = await db
        .selectFrom('raw_transactions')
        .where('processing_status', '=', 'processed')
        .where('account_id', '=', 1)
        .selectAll()
        .execute();
      expect(initialProcessed.length).toBeGreaterThan(0);

      // Reset processing status for kraken (account_id = 1)
      const result = await queries.resetProcessingStatusByAccount(1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should reset 3 records (all kraken records)
      }

      // Verify all kraken records are now pending
      const krakenRecords = await db.selectFrom('raw_transactions').where('account_id', '=', 1).selectAll().execute();

      expect(krakenRecords).toHaveLength(3);
      expect(krakenRecords.every((r) => r.processing_status === 'pending')).toBe(true);
      expect(krakenRecords.every((r) => r.processed_at === null)).toBe(true);

      // Verify ethereum records unchanged
      const ethereumProcessed = await db
        .selectFrom('raw_transactions')
        .where('processing_status', '=', 'processed')
        .where('account_id', '=', 2)
        .selectAll()
        .execute();
      expect(ethereumProcessed.length).toBeGreaterThan(0);
    });

    it('should return 0 when no records match the account', async () => {
      const result = await queries.resetProcessingStatusByAccount(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await queries.resetProcessingStatusByAccount(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Error message varies depending on when DB is destroyed
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('resetProcessingStatusAll', () => {
    it('should reset processing status for all records', async () => {
      // Verify initial state
      const initialProcessed = await db
        .selectFrom('raw_transactions')
        .where('processing_status', '=', 'processed')
        .selectAll()
        .execute();
      expect(initialProcessed.length).toBeGreaterThan(0);

      const result = await queries.resetProcessingStatusAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5); // Should reset all 5 records
      }

      // Verify all records are now pending
      const allRecords = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(allRecords).toHaveLength(5);
      expect(allRecords.every((r) => r.processing_status === 'pending')).toBe(true);
      expect(allRecords.every((r) => r.processed_at === null)).toBe(true);
    });

    it('should return 0 when no records exist', async () => {
      // Delete all records
      await db.deleteFrom('raw_transactions').execute();

      const result = await queries.resetProcessingStatusAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await queries.resetProcessingStatusAll();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Error message varies depending on when DB is destroyed
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('deleteByAccount', () => {
    it('should delete raw data records from a specific account', async () => {
      // Verify initial state
      const initialRecords = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(initialRecords).toHaveLength(5);

      // Delete kraken records (account_id = 1)
      const result = await queries.deleteByAccount(1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should delete 3 records
      }

      // Verify only ethereum records remain
      const remainingRecords = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(remainingRecords).toHaveLength(2);
      expect(remainingRecords.every((r) => r.account_id === 2)).toBe(true);
    });

    it('should return 0 when no records match the account', async () => {
      const result = await queries.deleteByAccount(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }

      // Verify all records remain
      const allRecords = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(allRecords).toHaveLength(5);
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await queries.deleteByAccount(1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Error message varies depending on when DB is destroyed
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('deleteAll', () => {
    it('should delete all raw data records', async () => {
      // Verify initial state
      const initialRecords = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(initialRecords).toHaveLength(5);

      // Delete all records
      const result = await queries.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }

      // Verify no records remain
      const remainingRecords = await db.selectFrom('raw_transactions').selectAll().execute();
      expect(remainingRecords).toHaveLength(0);
    });

    it('should return 0 when no records exist', async () => {
      // Delete all records first
      await db.deleteFrom('raw_transactions').execute();

      const result = await queries.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await queries.deleteAll();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Error message varies depending on when DB is destroyed
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('loadPendingByHashBatch', () => {
    beforeEach(async () => {
      // Clear existing test data
      await db.deleteFrom('raw_transactions').execute();

      // Create test data with blockchain transaction hashes
      // Account 2 (ethereum): 3 hashes with varying event counts
      // Hash 'hash-1': 3 events (normal, internal, token)
      // Hash 'hash-2': 2 events (normal, internal)
      // Hash 'hash-3': 1 event (normal)
      const testData = [
        // Hash 1 - 3 events
        {
          account_id: 2,
          provider_name: 'alchemy',
          event_id: 'evt-1-1',
          blockchain_transaction_hash: 'hash-1',
          source_address: null,
          transaction_type_hint: 'normal',
          provider_data: JSON.stringify({ type: 'normal' }),
          normalized_data: JSON.stringify({ type: 'normal' }),
          processing_status: 'pending' as const,
          processed_at: undefined,
          created_at: new Date('2024-01-01T10:00:00Z').toISOString(),
          timestamp: Date.now(),
        },
        {
          account_id: 2,
          provider_name: 'alchemy',
          event_id: 'evt-1-2',
          blockchain_transaction_hash: 'hash-1',
          source_address: null,
          transaction_type_hint: 'internal',
          provider_data: JSON.stringify({ type: 'internal' }),
          normalized_data: JSON.stringify({ type: 'internal' }),
          processing_status: 'pending' as const,
          processed_at: undefined,
          created_at: new Date('2024-01-01T10:00:01Z').toISOString(),
          timestamp: Date.now(),
        },
        {
          account_id: 2,
          provider_name: 'alchemy',
          event_id: 'evt-1-3',
          blockchain_transaction_hash: 'hash-1',
          source_address: null,
          transaction_type_hint: 'token',
          provider_data: JSON.stringify({ type: 'token' }),
          normalized_data: JSON.stringify({ type: 'token' }),
          processing_status: 'pending' as const,
          processed_at: undefined,
          created_at: new Date('2024-01-01T10:00:02Z').toISOString(),
          timestamp: Date.now(),
        },
        // Hash 2 - 2 events
        {
          account_id: 2,
          provider_name: 'alchemy',
          event_id: 'evt-2-1',
          blockchain_transaction_hash: 'hash-2',
          source_address: null,
          transaction_type_hint: 'normal',
          provider_data: JSON.stringify({ type: 'normal' }),
          normalized_data: JSON.stringify({ type: 'normal' }),
          processing_status: 'pending' as const,
          processed_at: undefined,
          created_at: new Date('2024-01-01T11:00:00Z').toISOString(),
          timestamp: Date.now(),
        },
        {
          account_id: 2,
          provider_name: 'alchemy',
          event_id: 'evt-2-2',
          blockchain_transaction_hash: 'hash-2',
          source_address: null,
          transaction_type_hint: 'internal',
          provider_data: JSON.stringify({ type: 'internal' }),
          normalized_data: JSON.stringify({ type: 'internal' }),
          processing_status: 'pending' as const,
          processed_at: undefined,
          created_at: new Date('2024-01-01T11:00:01Z').toISOString(),
          timestamp: Date.now(),
        },
        // Hash 3 - 1 event
        {
          account_id: 2,
          provider_name: 'alchemy',
          event_id: 'evt-3-1',
          blockchain_transaction_hash: 'hash-3',
          source_address: null,
          transaction_type_hint: 'normal',
          provider_data: JSON.stringify({ type: 'normal' }),
          normalized_data: JSON.stringify({ type: 'normal' }),
          processing_status: 'pending' as const,
          processed_at: undefined,
          created_at: new Date('2024-01-01T12:00:00Z').toISOString(),
          timestamp: Date.now(),
        },
        // Hash 4 - already processed (should be filtered out)
        {
          account_id: 2,
          provider_name: 'alchemy',
          event_id: 'evt-4-1',
          blockchain_transaction_hash: 'hash-4',
          source_address: null,
          transaction_type_hint: 'normal',
          provider_data: JSON.stringify({ type: 'normal' }),
          normalized_data: JSON.stringify({ type: 'normal' }),
          processing_status: 'processed' as const,
          processed_at: new Date().toISOString(),
          created_at: new Date('2024-01-01T13:00:00Z').toISOString(),
          timestamp: Date.now(),
        },
        // Different account (should be filtered out)
        {
          account_id: 1,
          provider_name: 'kraken',
          event_id: 'evt-other',
          blockchain_transaction_hash: 'hash-other',
          source_address: null,
          transaction_type_hint: null,
          provider_data: JSON.stringify({ type: 'exchange' }),
          normalized_data: JSON.stringify({ type: 'exchange' }),
          processing_status: 'pending' as const,
          processed_at: undefined,
          created_at: new Date('2024-01-01T14:00:00Z').toISOString(),
          timestamp: Date.now(),
        },
      ];

      for (const data of testData) {
        await db.insertInto('raw_transactions').values(data).execute();
      }
    });

    it('should load all events for the first N distinct hashes', async () => {
      const result = await queries.loadPendingByHashBatch(2, 2);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        // Should get 5 events total: 3 from hash-1 + 2 from hash-2
        expect(transactions).toHaveLength(5);

        // Verify all events belong to hash-1 or hash-2
        const hashes = new Set(transactions.map((t) => t.blockchainTransactionHash));
        expect(hashes.size).toBe(2);
        expect(hashes.has('hash-1')).toBe(true);
        expect(hashes.has('hash-2')).toBe(true);
      }
    });

    it('should group all events for the same hash together', async () => {
      const result = await queries.loadPendingByHashBatch(2, 1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        // Should get all 3 events from hash-1
        expect(transactions).toHaveLength(3);

        // All should have the same hash
        expect(transactions.every((t) => t.blockchainTransactionHash === 'hash-1')).toBe(true);

        // Verify we got all 3 event types
        const hints = transactions.map((t) => t.transactionTypeHint).sort();
        expect(hints).toEqual(['internal', 'normal', 'token']);
      }
    });

    it('should respect hash limit', async () => {
      const result = await queries.loadPendingByHashBatch(2, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        // Should get all pending events (3 + 2 + 1 = 6)
        expect(transactions).toHaveLength(6);

        // Should have exactly 3 distinct hashes (hash-1, hash-2, hash-3)
        const hashes = new Set(transactions.map((t) => t.blockchainTransactionHash));
        expect(hashes.size).toBe(3);
      }
    });

    it('should order by hash then by id', async () => {
      const result = await queries.loadPendingByHashBatch(2, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;

        // Extract hashes in order
        const hashes = transactions.map((t) => t.blockchainTransactionHash);

        // Should be grouped by hash
        expect(hashes.slice(0, 3)).toEqual(['hash-1', 'hash-1', 'hash-1']);
        expect(hashes.slice(3, 5)).toEqual(['hash-2', 'hash-2']);
        expect(hashes.slice(5, 6)).toEqual(['hash-3']);

        // Within each hash, events should be ordered by id
        for (let i = 1; i < transactions.length; i++) {
          const current = transactions[i];
          const prev = transactions[i - 1];
          if (current && prev && current.blockchainTransactionHash === prev.blockchainTransactionHash) {
            expect(current.id).toBeGreaterThan(prev.id);
          }
        }
      }
    });

    it('should filter by account_id', async () => {
      const result = await queries.loadPendingByHashBatch(1, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        // Should only get the kraken event (account 1 has hash-other)
        // But hash-other has blockchain_transaction_hash, so it should be loaded
        expect(transactions).toHaveLength(1);
        expect(transactions[0]?.accountId).toBe(1);
        expect(transactions[0]?.blockchainTransactionHash).toBe('hash-other');
      }
    });

    it('should only load pending events', async () => {
      const result = await queries.loadPendingByHashBatch(2, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const transactions = result.value;
        // Should not include hash-4 which is processed
        expect(transactions.every((t) => t.blockchainTransactionHash !== 'hash-4')).toBe(true);
        expect(transactions.every((t) => t.processingStatus === 'pending')).toBe(true);
      }
    });

    it('should return empty array when no pending data', async () => {
      // Mark all as processed
      await db
        .updateTable('raw_transactions')
        .set({ processing_status: 'processed', processed_at: new Date().toISOString() })
        .execute();

      const result = await queries.loadPendingByHashBatch(2, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return empty array for non-existent account', async () => {
      const result = await queries.loadPendingByHashBatch(999, 10);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await queries.loadPendingByHashBatch(2, 10);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});
