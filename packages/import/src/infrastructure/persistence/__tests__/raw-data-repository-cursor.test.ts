import { createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import { beforeEach, describe, expect, test } from 'vitest';

import { RawDataRepository } from '../raw-data-repository.ts';

describe('RawDataRepository - Cursor Management', () => {
  let db: KyselyDB;
  let repository: RawDataRepository;

  beforeEach(async () => {
    // Create in-memory database
    db = createDatabase(':memory:');
    // Run migrations to create schema
    await runMigrations(db);
    repository = new RawDataRepository(db);

    // Create a test data source
    const insertResult = await db
      .insertInto('data_sources')
      .values({
        created_at: new Date().toISOString(),
        import_params: '{}',
        import_result_metadata: '{}',
        source_id: 'kraken',
        source_type: 'exchange',
        started_at: new Date().toISOString(),
        status: 'started',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Verify session was created
    if (!insertResult) {
      throw new Error('Failed to create test data source ');
    }
  });

  describe('getLatestCursor', () => {
    test('should return null when no cursor data exists', async () => {
      const result = await repository.getLatestCursor(1);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    test('should return cursor from single transaction', async () => {
      await db
        .insertInto('external_transaction_data')
        .values({
          created_at: new Date().toISOString(),
          cursor: JSON.stringify({ trade: 1704067200000 }),
          external_id: 'tx1',
          data_source_id: 1,
          processing_status: 'pending',
          raw_data: '{}',
          normalized_data: '{}',
        })
        .execute();

      const result = await repository.getLatestCursor(1);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        trade: 1704067200000,
      });
    });

    test('should merge cursors from multiple transactions with same operation type', async () => {
      await db
        .insertInto('external_transaction_data')
        .values([
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ trade: 1704067200000 }),
            external_id: 'tx1',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ trade: 1704070800000 }),
            external_id: 'tx2',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ trade: 1704074400000 }),
            external_id: 'tx3',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
        ])
        .execute();

      const result = await repository.getLatestCursor(1);

      expect(result.isOk()).toBe(true);
      // Should return the maximum timestamp for trade operation
      expect(result._unsafeUnwrap()).toEqual({
        trade: 1704074400000,
      });
    });

    test('should merge cursors from multiple operation types', async () => {
      await db
        .insertInto('external_transaction_data')
        .values([
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ trade: 1704067200000 }),
            external_id: 'tx1',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ deposit: 1704070800000 }),
            external_id: 'tx2',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ withdrawal: 1704074400000 }),
            external_id: 'tx3',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ order: 1704078000000 }),
            external_id: 'tx4',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
        ])
        .execute();

      const result = await repository.getLatestCursor(1);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        deposit: 1704070800000,
        order: 1704078000000,
        trade: 1704067200000,
        withdrawal: 1704074400000,
      });
    });

    test('should take maximum timestamp per operation type when merging', async () => {
      await db
        .insertInto('external_transaction_data')
        .values([
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ trade: 1704067200000 }),
            external_id: 'tx1',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ deposit: 1704070800000, trade: 1704068000000 }),
            external_id: 'tx2',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ deposit: 1704071600000, withdrawal: 1704074400000 }),
            external_id: 'tx3',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ order: 1704078000000, trade: 1704075000000 }),
            external_id: 'tx4',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
        ])
        .execute();

      const result = await repository.getLatestCursor(1);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        deposit: 1704071600000, // max of 1704070800000, 1704071600000
        order: 1704078000000,
        trade: 1704075000000, // max of 1704067200000, 1704068000000, 1704075000000
        withdrawal: 1704074400000,
      });
    });

    test('should ignore transactions with null cursor', async () => {
      await db
        .insertInto('external_transaction_data')
        .values([
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ trade: 1704067200000 }),
            external_id: 'tx1',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: undefined,
            external_id: 'tx2',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ deposit: 1704070800000 }),
            external_id: 'tx3',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
        ])
        .execute();

      const result = await repository.getLatestCursor(1);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        deposit: 1704070800000,
        trade: 1704067200000,
      });
    });

    test('should filter by data source  ID', async () => {
      // Create second session
      await db
        .insertInto('data_sources')
        .values({
          created_at: new Date().toISOString(),
          import_params: '{}',
          import_result_metadata: '{}',
          source_id: 'kucoin',
          source_type: 'exchange',
          started_at: new Date().toISOString(),
          status: 'started',
        })
        .execute();

      await db
        .insertInto('external_transaction_data')
        .values([
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ trade: 1704067200000 }),
            external_id: 'tx1',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ trade: 1704999999999 }),
            external_id: 'tx2',
            data_source_id: 2,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
        ])
        .execute();

      const result = await repository.getLatestCursor(1);

      expect(result.isOk()).toBe(true);
      // Should only include session 1 data
      expect(result._unsafeUnwrap()).toEqual({
        trade: 1704067200000,
      });
    });

    test('should handle invalid cursor JSON gracefully', async () => {
      await db
        .insertInto('external_transaction_data')
        .values([
          {
            created_at: new Date().toISOString(),
            cursor: 'invalid json',
            external_id: 'tx1',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
          {
            created_at: new Date().toISOString(),
            cursor: JSON.stringify({ trade: 1704067200000 }),
            external_id: 'tx2',
            data_source_id: 1,
            processing_status: 'pending',
            raw_data: '{}',
            normalized_data: '{}',
          },
        ])
        .execute();

      const result = await repository.getLatestCursor(1);

      // Should fail gracefully due to JSON parse error
      expect(result.isErr()).toBe(true);
    });
  });
});
