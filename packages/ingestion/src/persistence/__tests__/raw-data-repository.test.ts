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

    // Create mock import sessions
    await db
      .insertInto('import_sessions')
      .values([
        {
          id: 1,
          source_type: 'exchange',
          source_id: 'kraken',
          started_at: new Date().toISOString(),
          status: 'completed',
          import_params: '{}',
          import_result_metadata: '{}',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
        {
          id: 2,
          source_type: 'blockchain',
          source_id: 'ethereum',
          started_at: new Date().toISOString(),
          status: 'completed',
          import_params: '{}',
          import_result_metadata: '{}',
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
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

  describe('resetProcessingStatusBySource', () => {
    it('should reset processing status for records from a specific source', async () => {
      // Verify initial state - some records are processed
      const initialProcessed = await db
        .selectFrom('external_transaction_data')
        .where('processing_status', '=', 'processed')
        .where('data_source_id', 'in', db.selectFrom('import_sessions').select('id').where('source_id', '=', 'kraken'))
        .selectAll()
        .execute();
      expect(initialProcessed.length).toBeGreaterThan(0);

      // Reset processing status for kraken
      const result = await repository.resetProcessingStatusBySource('kraken');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should reset 3 records (all kraken records)
      }

      // Verify all kraken records are now pending
      const krakenRecords = await db
        .selectFrom('external_transaction_data')
        .where('data_source_id', 'in', db.selectFrom('import_sessions').select('id').where('source_id', '=', 'kraken'))
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
        .where(
          'data_source_id',
          'in',
          db.selectFrom('import_sessions').select('id').where('source_id', '=', 'ethereum')
        )
        .selectAll()
        .execute();
      expect(ethereumProcessed.length).toBeGreaterThan(0);
    });

    it('should return 0 when no records match the source', async () => {
      const result = await repository.resetProcessingStatusBySource('nonexistent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.resetProcessingStatusBySource('kraken');

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

  describe('deleteBySource', () => {
    it('should delete raw data records from a specific source', async () => {
      // Verify initial state
      const initialRecords = await db.selectFrom('external_transaction_data').selectAll().execute();
      expect(initialRecords).toHaveLength(5);

      // Delete kraken records
      const result = await repository.deleteBySource('kraken');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should delete 3 records
      }

      // Verify only ethereum records remain
      const remainingRecords = await db.selectFrom('external_transaction_data').selectAll().execute();
      expect(remainingRecords).toHaveLength(2);
      expect(remainingRecords.every((r) => r.data_source_id === 2)).toBe(true);
    });

    it('should return 0 when no records match the source', async () => {
      const result = await repository.deleteBySource('nonexistent');

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

      const result = await repository.deleteBySource('kraken');

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
