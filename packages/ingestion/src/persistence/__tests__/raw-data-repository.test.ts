/* eslint-disable unicorn/no-null -- needed for db */
import { createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RawDataRepository } from '../raw-data-repository.js';

describe('RawDataRepository', () => {
  let db: KyselyDB;
  let repository: RawDataRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new RawDataRepository(db);

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
          import_result_metadata: '{}',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          transactions_imported: 0,
          transactions_failed: 0,
        },
        {
          id: 2,
          account_id: 2,
          started_at: new Date().toISOString(),
          status: 'completed',
          import_result_metadata: '{}',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          transactions_imported: 0,
          transactions_failed: 0,
        },
      ])
      .execute();

    // Create test raw data records
    for (let i = 1; i <= 5; i++) {
      await db
        .insertInto('external_transaction_data')
        .values({
          data_source_id: i <= 3 ? 1 : 2, // First 3 from kraken, last 2 from ethereum
          provider_name: i <= 3 ? 'kraken' : 'ethereum',
          external_id: `ext-${i}`,
          raw_data: JSON.stringify({ id: `ext-${i}`, amount: '100.00' }),
          normalized_data: '{}',
          processing_status: i % 2 === 0 ? 'processed' : 'pending',
          processed_at: i % 2 === 0 ? new Date().toISOString() : undefined,
          processing_error: undefined,
          created_at: new Date().toISOString(),
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
        .selectFrom('external_transaction_data')
        .where('processing_status', '=', 'processed')
        .where('data_source_id', 'in', db.selectFrom('import_sessions').select('id').where('account_id', '=', 1))
        .selectAll()
        .execute();
      expect(initialProcessed.length).toBeGreaterThan(0);

      // Reset processing status for kraken (account_id = 1)
      const result = await repository.resetProcessingStatusByAccount(1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should reset 3 records (all kraken records)
      }

      // Verify all kraken records are now pending
      const krakenRecords = await db
        .selectFrom('external_transaction_data')
        .where('data_source_id', 'in', db.selectFrom('import_sessions').select('id').where('account_id', '=', 1))
        .selectAll()
        .execute();

      expect(krakenRecords).toHaveLength(3);
      expect(krakenRecords.every((r) => r.processing_status === 'pending')).toBe(true);
      expect(krakenRecords.every((r) => r.processed_at === null)).toBe(true);
      expect(krakenRecords.every((r) => r.processing_error === null)).toBe(true);

      // Verify ethereum records unchanged
      const ethereumProcessed = await db
        .selectFrom('external_transaction_data')
        .where('processing_status', '=', 'processed')
        .where('data_source_id', 'in', db.selectFrom('import_sessions').select('id').where('account_id', '=', 2))
        .selectAll()
        .execute();
      expect(ethereumProcessed.length).toBeGreaterThan(0);
    });

    it('should return 0 when no records match the account', async () => {
      const result = await repository.resetProcessingStatusByAccount(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.resetProcessingStatusByAccount(1);

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
        .selectFrom('external_transaction_data')
        .where('processing_status', '=', 'processed')
        .selectAll()
        .execute();
      expect(initialProcessed.length).toBeGreaterThan(0);

      const result = await repository.resetProcessingStatusAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5); // Should reset all 5 records
      }

      // Verify all records are now pending
      const allRecords = await db.selectFrom('external_transaction_data').selectAll().execute();
      expect(allRecords).toHaveLength(5);
      expect(allRecords.every((r) => r.processing_status === 'pending')).toBe(true);
      expect(allRecords.every((r) => r.processed_at === null)).toBe(true);
      expect(allRecords.every((r) => r.processing_error === null)).toBe(true);
    });

    it('should return 0 when no records exist', async () => {
      // Delete all records
      await db.deleteFrom('external_transaction_data').execute();

      const result = await repository.resetProcessingStatusAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.resetProcessingStatusAll();

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
      const initialRecords = await db.selectFrom('external_transaction_data').selectAll().execute();
      expect(initialRecords).toHaveLength(5);

      // Delete kraken records (account_id = 1)
      const result = await repository.deleteByAccount(1);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should delete 3 records
      }

      // Verify only ethereum records remain
      const remainingRecords = await db.selectFrom('external_transaction_data').selectAll().execute();
      expect(remainingRecords).toHaveLength(2);
      expect(remainingRecords.every((r) => r.data_source_id === 2)).toBe(true);
    });

    it('should return 0 when no records match the account', async () => {
      const result = await repository.deleteByAccount(999);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }

      // Verify all records remain
      const allRecords = await db.selectFrom('external_transaction_data').selectAll().execute();
      expect(allRecords).toHaveLength(5);
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteByAccount(1);

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
      const initialRecords = await db.selectFrom('external_transaction_data').selectAll().execute();
      expect(initialRecords).toHaveLength(5);

      // Delete all records
      const result = await repository.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }

      // Verify no records remain
      const remainingRecords = await db.selectFrom('external_transaction_data').selectAll().execute();
      expect(remainingRecords).toHaveLength(0);
    });

    it('should return 0 when no records exist', async () => {
      // Delete all records first
      await db.deleteFrom('external_transaction_data').execute();

      const result = await repository.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteAll();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Error message varies depending on when DB is destroyed
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});
