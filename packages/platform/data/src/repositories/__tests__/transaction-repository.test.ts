import { createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TransactionRepository } from '../transaction-repository.js';

describe('TransactionRepository - delete methods', () => {
  let db: KyselyDB;
  let repository: TransactionRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new TransactionRepository(db);

    // Create mock import sessions for different sources
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
          transactions_imported: 3,
          transactions_failed: 0,
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
          transactions_imported: 2,
          transactions_failed: 0,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ])
      .execute();

    // Create test transactions with different sources
    for (let i = 1; i <= 5; i++) {
      await db
        .insertInto('transactions')
        .values({
          id: i,
          import_session_id: i <= 3 ? 1 : 2, // First 3 from kraken, last 2 from ethereum
          wallet_address_id: undefined,
          source_id: i <= 3 ? 'kraken' : 'ethereum',
          source_type: i <= 3 ? ('exchange' as const) : ('blockchain' as const),
          external_id: `tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date().toISOString(),
          from_address: undefined,
          to_address: undefined,
          verified: false,
          price: undefined,
          price_currency: undefined,
          note_type: undefined,
          note_severity: undefined,
          note_message: undefined,
          note_metadata: undefined,
          raw_normalized_data: '{}',
          movements_inflows: undefined,
          movements_outflows: undefined,
          fees_network: undefined,
          fees_platform: undefined,
          fees_total: undefined,
          operation_category: undefined,
          operation_type: 'deposit' as const,
          blockchain_name: undefined,
          blockchain_block_height: undefined,
          blockchain_transaction_hash: undefined,
          blockchain_is_confirmed: undefined,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('deleteBySource', () => {
    it('should delete all transactions from a specific source', async () => {
      // Verify initial state
      const initialTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(initialTransactions).toHaveLength(5);

      // Delete kraken transactions
      const result = await repository.deleteBySource('kraken');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should delete 3 transactions
      }

      // Verify only ethereum transactions remain
      const remainingTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(remainingTransactions).toHaveLength(2);
      expect(remainingTransactions.every((t) => t.source_id === 'ethereum')).toBe(true);
    });

    it('should return 0 when no transactions match the source', async () => {
      const result = await repository.deleteBySource('nonexistent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }

      // Verify all transactions remain
      const allTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(allTransactions).toHaveLength(5);
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
    it('should delete all transactions', async () => {
      // Verify initial state
      const initialTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(initialTransactions).toHaveLength(5);

      // Delete all transactions
      const result = await repository.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }

      // Verify no transactions remain
      const remainingTransactions = await db.selectFrom('transactions').selectAll().execute();
      expect(remainingTransactions).toHaveLength(0);
    });

    it('should return 0 when no transactions exist', async () => {
      // Delete all transactions first
      await db.deleteFrom('transactions').execute();

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
