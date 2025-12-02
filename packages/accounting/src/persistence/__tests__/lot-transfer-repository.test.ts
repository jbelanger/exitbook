/* eslint-disable unicorn/no-null -- null needed by db */
import { closeDatabase, createDatabase, runMigrations, type KyselyDB } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LotTransfer } from '../../domain/schemas.js';
import { LotTransferRepository } from '../lot-transfer-repository.js';

describe('LotTransferRepository', () => {
  let repo: LotTransferRepository;
  let db: KyselyDB;

  beforeEach(async () => {
    // Create in-memory database
    db = createDatabase(':memory:');
    // Run migrations to create schema
    await runMigrations(db);

    // Clear all data before each test
    await db.deleteFrom('lot_transfers').execute();
    await db.deleteFrom('acquisition_lots').execute();
    await db.deleteFrom('cost_basis_calculations').execute();
    await db.deleteFrom('transaction_links').execute();
    await db.deleteFrom('transactions').execute();
    await db.deleteFrom('import_sessions').execute();

    repo = new LotTransferRepository(db);

    // Create default user and account for foreign key constraints
    await db.insertInto('users').values({ id: 1, created_at: new Date().toISOString() }).execute();
    await db
      .insertInto('accounts')
      .values({
        id: 1,
        user_id: 1,
        parent_account_id: null,
        account_type: 'exchange-api',
        source_name: 'test',
        identifier: 'test-api-key',
        provider_name: null,
        last_cursor: null,
        last_balance_check_at: null,
        verification_metadata: null,
        created_at: new Date().toISOString(),
        updated_at: null,
      })
      .execute();

    // Create dummy import session for foreign key constraints
    await db
      .insertInto('import_sessions')
      .values({
        id: 1,
        account_id: 1,
        status: 'completed',
        started_at: new Date().toISOString(),
        import_result_metadata: '{}',
        transactions_imported: 0,
        transactions_failed: 0,
        created_at: new Date().toISOString(),
      })
      .execute();

    // Create dummy transactions
    for (let i = 1; i <= 10; i++) {
      await db
        .insertInto('transactions')
        .values({
          id: i,
          import_session_id: 1,
          source_id: 'test',
          source_type: 'exchange',
          transaction_status: 'success',
          transaction_datetime: new Date().toISOString(),
          excluded_from_accounting: false,
          raw_normalized_data: '{}',
          created_at: new Date().toISOString(),
        })
        .execute();
    }

    // Create dummy transaction link
    await db
      .insertInto('transaction_links')
      .values({
        id: 'link-1',
        source_transaction_id: 1,
        target_transaction_id: 2,
        asset: 'BTC',
        source_amount: '1.0',
        target_amount: '0.9995',
        link_type: 'exchange_to_blockchain',
        confidence_score: '0.98',
        match_criteria_json: '{"assetMatch": true}',
        status: 'confirmed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .execute();

    // Create dummy cost_basis_calculations
    await db
      .insertInto('cost_basis_calculations')
      .values([
        {
          id: 'calc-1',
          calculation_date: new Date().toISOString(),
          config_json: '{"method":"fifo","currency":"USD","jurisdiction":"CA","taxYear":2024}',
          total_proceeds: '0',
          total_cost_basis: '0',
          total_gain_loss: '0',
          total_taxable_gain_loss: '0',
          assets_processed: '[]',
          transactions_processed: 0,
          lots_created: 0,
          disposals_processed: 0,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
        {
          id: 'calc-2',
          calculation_date: new Date().toISOString(),
          config_json: '{"method":"fifo","currency":"USD","jurisdiction":"CA","taxYear":2024}',
          total_proceeds: '0',
          total_cost_basis: '0',
          total_gain_loss: '0',
          total_taxable_gain_loss: '0',
          assets_processed: '[]',
          transactions_processed: 0,
          lots_created: 0,
          disposals_processed: 0,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ])
      .execute();

    // Create dummy acquisition lots
    await db
      .insertInto('acquisition_lots')
      .values([
        {
          id: 'lot-1',
          calculation_id: 'calc-1',
          acquisition_transaction_id: 1,
          asset: 'BTC',
          quantity: '1.0',
          cost_basis_per_unit: '50000.00',
          total_cost_basis: '50000.00',
          acquisition_date: new Date().toISOString(),
          method: 'fifo',
          remaining_quantity: '1.0',
          status: 'open',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'lot-2',
          calculation_id: 'calc-1',
          acquisition_transaction_id: 3,
          asset: 'ETH',
          quantity: '10.0',
          cost_basis_per_unit: '2000.00',
          total_cost_basis: '20000.00',
          acquisition_date: new Date().toISOString(),
          method: 'fifo',
          remaining_quantity: '10.0',
          status: 'open',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])
      .execute();
  });

  afterEach(async () => {
    await closeDatabase(db);
  });

  describe('create', () => {
    it('should create a lot transfer with all required fields', async () => {
      const transfer: LotTransfer = {
        id: uuidv4(),
        calculationId: 'calc-1',
        sourceLotId: 'lot-1',
        linkId: 'link-1',
        quantityTransferred: new Decimal('1.0'),
        costBasisPerUnit: new Decimal('50000.00'),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        createdAt: new Date(),
      };

      const result = await repo.create(transfer);

      expect(result.isOk()).toBe(true);
    });

    it('should store very small quantities correctly', async () => {
      const transfer: LotTransfer = {
        id: uuidv4(),
        calculationId: 'calc-1',
        sourceLotId: 'lot-1',
        linkId: 'link-1',
        quantityTransferred: new Decimal('0.00000001'),
        costBasisPerUnit: new Decimal('50000.00'),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        createdAt: new Date(),
      };

      const createResult = await repo.create(transfer);
      expect(createResult.isOk()).toBe(true);

      const fetchResult = await repo.getByLinkId('link-1');
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk()) {
        expect(fetchResult.value).toHaveLength(1);
        expect(fetchResult.value[0]?.quantityTransferred.toFixed()).toBe('0.00000001');
      }
    });

    it('should store very large quantities correctly', async () => {
      const transfer: LotTransfer = {
        id: uuidv4(),
        calculationId: 'calc-1',
        sourceLotId: 'lot-1',
        linkId: 'link-1',
        quantityTransferred: new Decimal('1000000000.123456789'),
        costBasisPerUnit: new Decimal('0.00001'),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        createdAt: new Date(),
      };

      const createResult = await repo.create(transfer);
      expect(createResult.isOk()).toBe(true);

      const fetchResult = await repo.getByLinkId('link-1');
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk()) {
        expect(fetchResult.value).toHaveLength(1);
        expect(fetchResult.value[0]?.quantityTransferred.toFixed()).toBe('1000000000.123456789');
      }
    });

    it('should store metadata correctly', async () => {
      const transfer: LotTransfer = {
        id: uuidv4(),
        calculationId: 'calc-1',
        sourceLotId: 'lot-1',
        linkId: 'link-1',
        quantityTransferred: new Decimal('1.0'),
        costBasisPerUnit: new Decimal('50000.00'),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        createdAt: new Date(),
        metadata: {
          cryptoFeeUsdValue: new Decimal('25.50'),
        },
      };

      const createResult = await repo.create(transfer);
      expect(createResult.isOk()).toBe(true);

      const fetchResult = await repo.getByLinkId('link-1');
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk()) {
        expect(fetchResult.value).toHaveLength(1);
        expect(fetchResult.value[0]?.metadata).toBeDefined();
        expect(fetchResult.value[0]?.metadata?.cryptoFeeUsdValue?.toFixed()).toBe('25.5');
      }
    });

    it('should handle missing optional metadata', async () => {
      const transfer: LotTransfer = {
        id: uuidv4(),
        calculationId: 'calc-1',
        sourceLotId: 'lot-1',
        linkId: 'link-1',
        quantityTransferred: new Decimal('1.0'),
        costBasisPerUnit: new Decimal('50000.00'),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        createdAt: new Date(),
      };

      const createResult = await repo.create(transfer);
      expect(createResult.isOk()).toBe(true);

      const fetchResult = await repo.getByLinkId('link-1');
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk()) {
        expect(fetchResult.value).toHaveLength(1);
        expect(fetchResult.value[0]?.metadata).toBeUndefined();
      }
    });

    it('should preserve cost basis precision', async () => {
      const transfer: LotTransfer = {
        id: uuidv4(),
        calculationId: 'calc-1',
        sourceLotId: 'lot-1',
        linkId: 'link-1',
        quantityTransferred: new Decimal('1.0'),
        costBasisPerUnit: new Decimal('50123.456789012345'),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        createdAt: new Date(),
      };

      const createResult = await repo.create(transfer);
      expect(createResult.isOk()).toBe(true);

      const fetchResult = await repo.getByLinkId('link-1');
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk()) {
        expect(fetchResult.value).toHaveLength(1);
        expect(fetchResult.value[0]?.costBasisPerUnit.toFixed()).toBe('50123.456789012345');
      }
    });
  });

  describe('createBulk', () => {
    it('should create multiple lot transfers', async () => {
      const transfers: LotTransfer[] = [
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 3,
          createdAt: new Date(),
        },
      ];

      const result = await repo.createBulk(transfers);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(2);
      }

      const fetchResult = await repo.getByLinkId('link-1');
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk()) {
        expect(fetchResult.value).toHaveLength(2);
      }
    });

    it('should handle empty array gracefully', async () => {
      const result = await repo.createBulk([]);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });

    it('should create transfers with different metadata', async () => {
      const transfers: LotTransfer[] = [
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
          metadata: {
            cryptoFeeUsdValue: new Decimal('10.00'),
          },
        },
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.3'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 3,
          createdAt: new Date(),
          metadata: {
            cryptoFeeUsdValue: new Decimal('20.00'),
          },
        },
      ];

      const result = await repo.createBulk(transfers);
      expect(result.isOk()).toBe(true);

      const fetchResult = await repo.getByLinkId('link-1');
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk()) {
        expect(fetchResult.value).toHaveLength(2);
        expect(fetchResult.value[0]?.metadata?.cryptoFeeUsdValue?.toFixed()).toBe('10');
        expect(fetchResult.value[1]?.metadata?.cryptoFeeUsdValue?.toFixed()).toBe('20');
      }
    });
  });

  describe('getByCalculationId', () => {
    it('should retrieve all transfers for a calculation', async () => {
      const transfers: LotTransfer[] = [
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.3'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 3,
          createdAt: new Date(),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-2',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.2'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 4,
          createdAt: new Date(),
        },
      ];

      await repo.createBulk(transfers);

      const result = await repo.getByCalculationId('calc-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((t) => t.calculationId === 'calc-1')).toBe(true);
      }
    });

    it('should return empty array for non-existent calculation', async () => {
      const result = await repo.getByCalculationId('non-existent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should order results by created_at ascending', async () => {
      const now = new Date();
      const transfers: LotTransfer[] = [
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.3'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 3,
          createdAt: new Date(now.getTime() + 2000),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(now.getTime() + 1000),
        },
      ];

      await repo.createBulk(transfers);

      const result = await repo.getByCalculationId('calc-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.quantityTransferred.toFixed()).toBe('0.5');
        expect(result.value[1]?.quantityTransferred.toFixed()).toBe('0.3');
      }
    });
  });

  describe('getByLinkId', () => {
    it('should retrieve all transfers for a link', async () => {
      // Create another link for testing
      await db
        .insertInto('transaction_links')
        .values({
          id: 'link-2',
          source_transaction_id: 3,
          target_transaction_id: 4,
          asset: 'ETH',
          source_amount: '10.0',
          target_amount: '9.99',
          link_type: 'exchange_to_blockchain',
          confidence_score: '0.95',
          match_criteria_json: '{"assetMatch": true}',
          status: 'confirmed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();

      const transfers: LotTransfer[] = [
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-2',
          quantityTransferred: new Decimal('0.3'),
          costBasisPerUnit: new Decimal('2000.00'),
          sourceTransactionId: 3,
          targetTransactionId: 4,
          createdAt: new Date(),
        },
      ];

      await repo.createBulk(transfers);

      const result = await repo.getByLinkId('link-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.linkId).toBe('link-1');
        expect(result.value[0]?.quantityTransferred.toFixed()).toBe('0.5');
      }
    });

    it('should return empty array for non-existent link', async () => {
      const result = await repo.getByLinkId('non-existent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('getBySourceLot', () => {
    it('should retrieve all transfers from a source lot', async () => {
      const transfers: LotTransfer[] = [
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.3'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 3,
          createdAt: new Date(),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-2',
          linkId: 'link-1',
          quantityTransferred: new Decimal('5.0'),
          costBasisPerUnit: new Decimal('2000.00'),
          sourceTransactionId: 3,
          targetTransactionId: 4,
          createdAt: new Date(),
        },
      ];

      await repo.createBulk(transfers);

      const result = await repo.getBySourceLot('lot-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((t) => t.sourceLotId === 'lot-1')).toBe(true);
      }
    });

    it('should return empty array for non-existent lot', async () => {
      const result = await repo.getBySourceLot('non-existent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('deleteByCalculationId', () => {
    it('should delete all transfers for a calculation', async () => {
      const transfers: LotTransfer[] = [
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.3'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 3,
          createdAt: new Date(),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-2',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.2'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 4,
          createdAt: new Date(),
        },
      ];

      await repo.createBulk(transfers);

      const deleteResult = await repo.deleteByCalculationId('calc-1');

      expect(deleteResult.isOk()).toBe(true);
      if (deleteResult.isOk()) {
        expect(deleteResult.value).toBe(2);
      }

      const fetchResult = await repo.getByCalculationId('calc-1');
      expect(fetchResult.isOk()).toBe(true);
      if (fetchResult.isOk()) {
        expect(fetchResult.value).toHaveLength(0);
      }

      const calc2Result = await repo.getByCalculationId('calc-2');
      expect(calc2Result.isOk()).toBe(true);
      if (calc2Result.isOk()) {
        expect(calc2Result.value).toHaveLength(1);
      }
    });

    it('should return 0 for non-existent calculation', async () => {
      const result = await repo.deleteByCalculationId('non-existent');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });
  });

  describe('deleteAll', () => {
    it('should delete all lot transfers', async () => {
      const transfers: LotTransfer[] = [
        {
          id: uuidv4(),
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
        },
        {
          id: uuidv4(),
          calculationId: 'calc-2',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.3'),
          costBasisPerUnit: new Decimal('50000.00'),
          sourceTransactionId: 1,
          targetTransactionId: 3,
          createdAt: new Date(),
        },
      ];

      await repo.createBulk(transfers);

      const deleteResult = await repo.deleteAll();

      expect(deleteResult.isOk()).toBe(true);
      if (deleteResult.isOk()) {
        expect(deleteResult.value).toBe(2);
      }

      const calc1Result = await repo.getByCalculationId('calc-1');
      expect(calc1Result.isOk()).toBe(true);
      if (calc1Result.isOk()) {
        expect(calc1Result.value).toHaveLength(0);
      }

      const calc2Result = await repo.getByCalculationId('calc-2');
      expect(calc2Result.isOk()).toBe(true);
      if (calc2Result.isOk()) {
        expect(calc2Result.value).toHaveLength(0);
      }
    });

    it('should return 0 when no transfers exist', async () => {
      const result = await repo.deleteAll();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(0);
      }
    });
  });

  describe('error handling', () => {
    it('should handle corrupted JSON metadata gracefully during retrieval', async () => {
      // Create a transfer with valid data
      const transfer: LotTransfer = {
        id: uuidv4(),
        calculationId: 'calc-1',
        sourceLotId: 'lot-1',
        linkId: 'link-1',
        quantityTransferred: new Decimal('1.0'),
        costBasisPerUnit: new Decimal('50000.00'),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        createdAt: new Date(),
      };

      await repo.create(transfer);

      // Manually corrupt the metadata_json in the database with invalid JSON
      await db
        .updateTable('lot_transfers')
        .set({ metadata_json: '{invalid json}' })
        .where('id', '=', transfer.id)
        .execute();

      const result = await repo.getByLinkId('link-1');

      // Should fail gracefully with error result
      expect(result.isErr()).toBe(true);
    });
  });

  describe('data integrity', () => {
    it('should preserve Decimal precision through round-trip', async () => {
      const transfer: LotTransfer = {
        id: uuidv4(),
        calculationId: 'calc-1',
        sourceLotId: 'lot-1',
        linkId: 'link-1',
        quantityTransferred: new Decimal('0.123456789012345678'),
        costBasisPerUnit: new Decimal('98765.432109876543'),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        createdAt: new Date(),
        metadata: {
          cryptoFeeUsdValue: new Decimal('1.234567890123456'),
        },
      };

      await repo.create(transfer);

      const result = await repo.getByLinkId('link-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const retrieved = result.value[0];
        expect(retrieved?.quantityTransferred.toFixed()).toBe('0.123456789012345678');
        expect(retrieved?.costBasisPerUnit.toFixed()).toBe('98765.432109876543');
        expect(retrieved?.metadata?.cryptoFeeUsdValue?.toFixed()).toBe('1.234567890123456');
      }
    });

    it('should maintain transaction relationship integrity', async () => {
      const transfer: LotTransfer = {
        id: uuidv4(),
        calculationId: 'calc-1',
        sourceLotId: 'lot-1',
        linkId: 'link-1',
        quantityTransferred: new Decimal('1.0'),
        costBasisPerUnit: new Decimal('50000.00'),
        sourceTransactionId: 1,
        targetTransactionId: 2,
        createdAt: new Date(),
      };

      await repo.create(transfer);

      const result = await repo.getByLinkId('link-1');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const retrieved = result.value[0];
        expect(retrieved?.sourceTransactionId).toBe(1);
        expect(retrieved?.targetTransactionId).toBe(2);
        expect(retrieved?.linkId).toBe('link-1');
        expect(retrieved?.sourceLotId).toBe('lot-1');
      }
    });
  });
});
