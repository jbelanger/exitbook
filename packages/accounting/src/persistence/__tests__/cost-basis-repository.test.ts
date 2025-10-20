/* eslint-disable unicorn/no-null -- null required for db */
import { createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CostBasisRepository } from '../cost-basis-repository.js';

describe('CostBasisRepository', () => {
  let db: KyselyDB;
  let repository: CostBasisRepository;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    await runMigrations(db);
    repository = new CostBasisRepository(db);

    // Create mock import sessions for foreign key constraints
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
          transactions_imported: 0,
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
          transactions_imported: 0,
          transactions_failed: 0,
          created_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      ])
      .execute();

    // Create test cost basis calculations FIRST (for FK constraints)
    for (let i = 1; i <= 3; i++) {
      await db
        .insertInto('cost_basis_calculations')
        .values({
          id: `calc-${i}`,
          calculation_date: Math.floor(Date.now() / 1000),
          config_json: '{}',
          start_date: undefined,
          end_date: undefined,
          total_proceeds: '120000.00',
          total_cost_basis: '100000.00',
          total_gain_loss: '20000.00',
          total_taxable_gain_loss: '10000.00',
          assets_processed: '["BTC"]',
          transactions_processed: 0,
          lots_created: 0,
          disposals_processed: 0,
          status: 'completed',
          error_message: undefined,
          created_at: Math.floor(Date.now() / 1000),
          completed_at: Math.floor(Date.now() / 1000),
          metadata_json: undefined,
        })
        .execute();
    }

    // Create test transactions with different sources
    for (let i = 1; i <= 5; i++) {
      const isInflow = i % 2 === 0;
      await db
        .insertInto('transactions')
        .values({
          id: i,
          import_session_id: i <= 3 ? 1 : 2, // First 3 from kraken, last 2 from ethereum
          source_id: i <= 3 ? 'kraken' : 'ethereum',
          source_type: 'exchange' as const,
          external_id: `tx-${i}`,
          transaction_status: 'success' as const,
          transaction_datetime: new Date().toISOString(),
          raw_normalized_data: '{}',
          movements_inflows: isInflow ? JSON.stringify([{ asset: 'BTC', amount: '1.0' }]) : null,
          movements_outflows: isInflow ? null : JSON.stringify([{ asset: 'BTC', amount: '1.0' }]),
          created_at: new Date().toISOString(),
        })
        .execute();
    }

    // Create test acquisition lots
    for (let i = 1; i <= 5; i++) {
      await db
        .insertInto('acquisition_lots')
        .values({
          id: `lot-${i}`,
          calculation_id: 'calc-1',
          acquisition_transaction_id: i,
          asset: 'BTC',
          quantity: '1.0',
          cost_basis_per_unit: '50000.00',
          total_cost_basis: '50000.00',
          acquisition_date: Math.floor(Date.now() / 1000),
          method: 'fifo',
          remaining_quantity: '0.5',
          status: 'partially_disposed',
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
          metadata_json: undefined,
        })
        .execute();
    }

    // Create test lot disposals
    for (let i = 1; i <= 5; i++) {
      await db
        .insertInto('lot_disposals')
        .values({
          id: `disposal-${i}`,
          lot_id: `lot-${i}`,
          disposal_transaction_id: i,
          quantity_disposed: '0.5',
          proceeds_per_unit: '50000.00',
          total_proceeds: '25000.00',
          cost_basis_per_unit: '50000.00',
          total_cost_basis: '25000.00',
          gain_loss: '0.00',
          disposal_date: Math.floor(Date.now() / 1000),
          holding_period_days: 30,
          tax_treatment_category: undefined,
          created_at: Math.floor(Date.now() / 1000),
          metadata_json: undefined,
        })
        .execute();
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe('deleteDisposalsBySource', () => {
    it('should delete disposals for lots from a specific source', async () => {
      // Verify initial state
      const initialDisposals = await db.selectFrom('lot_disposals').selectAll().execute();
      expect(initialDisposals).toHaveLength(5);

      // Delete disposals for kraken transactions
      const result = await repository.deleteDisposalsBySource('kraken');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should delete 3 disposals (for transactions 1, 2, 3)
      }

      // Verify remaining disposals
      const remainingDisposals = await db.selectFrom('lot_disposals').selectAll().execute();
      expect(remainingDisposals).toHaveLength(2);
      // Only ethereum lots remain (lot-4 and lot-5)
      expect(remainingDisposals.every((d) => d.lot_id === 'lot-4' || d.lot_id === 'lot-5')).toBe(true);
    });

    it('should return 0 when no disposals match the source', async () => {
      const result = await repository.deleteDisposalsBySource('nonexistent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }

      // Verify all disposals remain
      const disposals = await db.selectFrom('lot_disposals').selectAll().execute();
      expect(disposals).toHaveLength(5);
    });

    it('should handle database errors', async () => {
      // Destroy the database to trigger an error
      await db.destroy();

      const result = await repository.deleteDisposalsBySource('kraken');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to delete lot disposals by source');
      }
    });
  });

  describe('deleteLotsBySource', () => {
    it('should delete acquisition lots for transactions from a specific source', async () => {
      // Need to delete disposals first due to FK constraint
      await repository.deleteDisposalsBySource('kraken');

      // Verify initial state
      const initialLots = await db.selectFrom('acquisition_lots').selectAll().execute();
      expect(initialLots).toHaveLength(5);

      // Delete lots for kraken transactions
      const result = await repository.deleteLotsBySource('kraken');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3); // Should delete 3 lots (for transactions 1, 2, 3)
      }

      // Verify remaining lots
      const remainingLots = await db.selectFrom('acquisition_lots').selectAll().execute();
      expect(remainingLots).toHaveLength(2);
      expect(remainingLots.every((lot) => lot.acquisition_transaction_id > 3)).toBe(true);
    });

    it('should return 0 when no lots match the source', async () => {
      const result = await repository.deleteLotsBySource('nonexistent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }

      // Verify all lots remain
      const lots = await db.selectFrom('acquisition_lots').selectAll().execute();
      expect(lots).toHaveLength(5);
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteLotsBySource('kraken');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to delete acquisition lots by source');
      }
    });
  });

  describe('deleteAllDisposals', () => {
    it('should delete all lot disposals', async () => {
      // Verify initial state
      const initialDisposals = await db.selectFrom('lot_disposals').selectAll().execute();
      expect(initialDisposals).toHaveLength(5);

      // Delete all disposals
      const result = await repository.deleteAllDisposals();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }

      // Verify no disposals remain
      const remainingDisposals = await db.selectFrom('lot_disposals').selectAll().execute();
      expect(remainingDisposals).toHaveLength(0);
    });

    it('should return 0 when no disposals exist', async () => {
      // Delete all disposals first
      await db.deleteFrom('lot_disposals').execute();

      const result = await repository.deleteAllDisposals();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteAllDisposals();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to delete all lot disposals');
      }
    });
  });

  describe('deleteAllLots', () => {
    it('should delete all acquisition lots', async () => {
      // Need to delete disposals first due to FK constraint
      await repository.deleteAllDisposals();

      // Verify initial state
      const initialLots = await db.selectFrom('acquisition_lots').selectAll().execute();
      expect(initialLots).toHaveLength(5);

      // Delete all lots
      const result = await repository.deleteAllLots();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(5);
      }

      // Verify no lots remain
      const remainingLots = await db.selectFrom('acquisition_lots').selectAll().execute();
      expect(remainingLots).toHaveLength(0);
    });

    it('should return 0 when no lots exist', async () => {
      // Delete all data first
      await db.deleteFrom('lot_disposals').execute();
      await db.deleteFrom('acquisition_lots').execute();

      const result = await repository.deleteAllLots();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteAllLots();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to delete all acquisition lots');
      }
    });
  });

  describe('deleteAllCalculations', () => {
    it('should delete all cost basis calculations', async () => {
      // Need to delete disposals and lots first due to FK constraint
      await repository.deleteAllDisposals();
      await repository.deleteAllLots();

      // Verify initial state
      const initialCalculations = await db.selectFrom('cost_basis_calculations').selectAll().execute();
      expect(initialCalculations).toHaveLength(3);

      // Delete all calculations
      const result = await repository.deleteAllCalculations();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(3);
      }

      // Verify no calculations remain
      const remainingCalculations = await db.selectFrom('cost_basis_calculations').selectAll().execute();
      expect(remainingCalculations).toHaveLength(0);
    });

    it('should return 0 when no calculations exist', async () => {
      // Delete all data first (in correct order)
      await db.deleteFrom('lot_disposals').execute();
      await db.deleteFrom('acquisition_lots').execute();
      await db.deleteFrom('cost_basis_calculations').execute();

      const result = await repository.deleteAllCalculations();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should handle database errors', async () => {
      await db.destroy();

      const result = await repository.deleteAllCalculations();

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Failed to delete all cost basis calculations');
      }
    });
  });
});
