/* eslint-disable unicorn/no-null -- null needed by Kysely */
import { DecimalSchema, wrapError } from '@exitbook/core';
import { BaseRepository, type KyselyDB } from '@exitbook/data';
import type { Selectable } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import {
  AcquisitionLotSchema,
  CostBasisCalculationSchema,
  LotDisposalSchema,
  type AcquisitionLot,
  type CostBasisCalculation,
  type LotDisposal,
  type LotStatus,
} from '../domain/schemas.js';

type StoredAcquisitionLot = Selectable<{
  acquisition_date: string;
  acquisition_transaction_id: number;
  asset: string;
  calculation_id: string;
  cost_basis_per_unit: string;
  created_at: string;
  id: string;
  metadata_json: string | null;
  method: 'fifo' | 'lifo' | 'specific-id' | 'average-cost';
  quantity: string;
  remaining_quantity: string;
  status: 'open' | 'partially_disposed' | 'fully_disposed';
  total_cost_basis: string;
  updated_at: string;
}>;

type StoredLotDisposal = Selectable<{
  cost_basis_per_unit: string;
  created_at: string;
  disposal_date: string;
  disposal_transaction_id: number;
  gain_loss: string;
  holding_period_days: number;
  id: string;
  lot_id: string;
  metadata_json: string | null;
  proceeds_per_unit: string;
  quantity_disposed: string;
  tax_treatment_category: string | null;
  total_cost_basis: string;
  total_proceeds: string;
}>;

type StoredCostBasisCalculation = Selectable<{
  assets_processed: string;
  calculation_date: string;
  completed_at: string | null;
  config_json: string;
  created_at: string;
  disposals_processed: number;
  end_date: string | null;
  error_message: string | null;
  id: string;
  lots_created: number;
  metadata_json: string | null;
  start_date: string | null;
  status: 'pending' | 'completed' | 'failed';
  total_cost_basis: string;
  total_gain_loss: string;
  total_proceeds: string;
  total_taxable_gain_loss: string;
  transactions_processed: number;
}>;

/**
 * Repository for cost basis data operations
 * Handles acquisition_lots, lot_disposals, and cost_basis_calculations tables
 */
export class CostBasisRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'CostBasisRepository');
  }

  // ==================== ACQUISITION LOTS ====================

  /**
   * Create a new acquisition lot
   */
  async createLot(lot: AcquisitionLot): Promise<Result<string, Error>> {
    try {
      await this.db
        .insertInto('acquisition_lots')
        .values({
          id: lot.id,
          calculation_id: lot.calculationId,
          acquisition_transaction_id: lot.acquisitionTransactionId,
          asset: lot.assetSymbol,
          quantity: lot.quantity.toFixed(),
          cost_basis_per_unit: lot.costBasisPerUnit.toFixed(),
          total_cost_basis: lot.totalCostBasis.toFixed(),
          acquisition_date: lot.acquisitionDate.toISOString(),
          method: lot.method,
          remaining_quantity: lot.remainingQuantity.toFixed(),
          status: lot.status,
          created_at: lot.createdAt.toISOString(),
          updated_at: lot.updatedAt.toISOString(),
          metadata_json: this.serializeToJson(lot.metadata) ?? null,
        })
        .execute();

      this.logger.debug({ lotId: lot.id }, 'Created acquisition lot');
      return ok(lot.id);
    } catch (error) {
      this.logger.error({ error }, 'Failed to create acquisition lot');
      return wrapError(error, 'Failed to create acquisition lot');
    }
  }

  /**
   * Bulk create acquisition lots
   */
  async createLotsBulk(lots: AcquisitionLot[]): Promise<Result<number, Error>> {
    try {
      if (lots.length === 0) {
        return ok(0);
      }

      const values = lots.map((lot) => ({
        id: lot.id,
        calculation_id: lot.calculationId,
        acquisition_transaction_id: lot.acquisitionTransactionId,
        asset: lot.assetSymbol,
        quantity: lot.quantity.toFixed(),
        cost_basis_per_unit: lot.costBasisPerUnit.toFixed(),
        total_cost_basis: lot.totalCostBasis.toFixed(),
        acquisition_date: lot.acquisitionDate.toISOString(),
        method: lot.method,
        remaining_quantity: lot.remainingQuantity.toFixed(),
        status: lot.status,
        created_at: lot.createdAt.toISOString(),
        updated_at: lot.updatedAt.toISOString(),
        metadata_json: this.serializeToJson(lot.metadata) ?? null,
      }));

      await this.db.insertInto('acquisition_lots').values(values).execute();

      this.logger.info({ count: lots.length }, 'Bulk created acquisition lots');
      return ok(lots.length);
    } catch (error) {
      this.logger.error({ error }, 'Failed to bulk create acquisition lots');
      return wrapError(error, 'Failed to bulk create acquisition lots');
    }
  }

  /**
   * Find lot by ID
   */
  async findLotById(id: string): Promise<Result<AcquisitionLot | null, Error>> {
    try {
      const row = await this.db.selectFrom('acquisition_lots').selectAll().where('id', '=', id).executeTakeFirst();

      if (!row) {
        return ok(null);
      }

      const result = this.toAcquisitionLot(row as StoredAcquisitionLot);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      this.logger.error({ error, id }, 'Failed to find acquisition lot by ID');
      return wrapError(error, 'Failed to find acquisition lot');
    }
  }

  /**
   * Find lots by asset, optionally filtered by status
   */
  async findLotsByAsset(assetSymbol: string, status?: LotStatus): Promise<Result<AcquisitionLot[], Error>> {
    try {
      let query = this.db.selectFrom('acquisition_lots').selectAll().where('asset', '=', assetSymbol);

      if (status) {
        query = query.where('status', '=', status);
      }

      // Order by acquisition date ascending (oldest first - FIFO default)
      query = query.orderBy('acquisition_date', 'asc');

      const rows = await query.execute();

      const lots: AcquisitionLot[] = [];
      for (const row of rows) {
        const result = this.toAcquisitionLot(row as StoredAcquisitionLot);
        if (result.isErr()) {
          return err(result.error);
        }
        lots.push(result.value);
      }

      return ok(lots);
    } catch (error) {
      this.logger.error({ error, assetSymbol: assetSymbol, status }, 'Failed to find lots by asset');
      return wrapError(error, 'Failed to find lots by asset');
    }
  }

  /**
   * Find all open lots for an asset (status = 'open' or 'partially_disposed')
   */
  async findOpenLots(assetSymbol: string): Promise<Result<AcquisitionLot[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('acquisition_lots')
        .selectAll()
        .where('asset', '=', assetSymbol)
        .where((eb) => eb.or([eb('status', '=', 'open'), eb('status', '=', 'partially_disposed')]))
        .orderBy('acquisition_date', 'asc')
        .execute();

      const lots: AcquisitionLot[] = [];
      for (const row of rows) {
        const result = this.toAcquisitionLot(row as StoredAcquisitionLot);
        if (result.isErr()) {
          return err(result.error);
        }
        lots.push(result.value);
      }

      return ok(lots);
    } catch (error) {
      this.logger.error({ error, assetSymbol }, 'Failed to find open lots');
      return wrapError(error, 'Failed to find open lots');
    }
  }

  /**
   * Find lots by calculation ID
   */
  async findLotsByCalculationId(calculationId: string): Promise<Result<AcquisitionLot[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('acquisition_lots')
        .selectAll()
        .where('calculation_id', '=', calculationId)
        .orderBy('acquisition_date', 'asc')
        .execute();

      const lots: AcquisitionLot[] = [];
      for (const row of rows) {
        const result = this.toAcquisitionLot(row as StoredAcquisitionLot);
        if (result.isErr()) {
          return err(result.error);
        }
        lots.push(result.value);
      }

      return ok(lots);
    } catch (error) {
      this.logger.error({ error, calculationId }, 'Failed to find lots by calculation ID');
      return wrapError(error, 'Failed to find lots by calculation ID');
    }
  }

  /**
   * Update lot (typically to update status and remaining quantity)
   */
  async updateLot(id: string, updates: Partial<AcquisitionLot>): Promise<Result<boolean, Error>> {
    try {
      const updateValues: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (updates.remainingQuantity !== undefined) {
        updateValues['remaining_quantity'] = updates.remainingQuantity.toFixed();
      }
      if (updates.status !== undefined) {
        updateValues['status'] = updates.status;
      }
      if (updates.metadata !== undefined) {
        updateValues['metadata_json'] = this.serializeToJson(updates.metadata) ?? null;
      }

      const result = await this.db.updateTable('acquisition_lots').set(updateValues).where('id', '=', id).execute();

      const updated = result[0] ? Number(result[0].numUpdatedRows ?? 0) > 0 : false;
      this.logger.debug({ lotId: id, updated }, 'Updated acquisition lot');
      return ok(updated);
    } catch (error) {
      this.logger.error({ error, id }, 'Failed to update acquisition lot');
      return wrapError(error, 'Failed to update acquisition lot');
    }
  }

  // ==================== LOT DISPOSALS ====================

  /**
   * Create a new lot disposal
   */
  async createDisposal(disposal: LotDisposal): Promise<Result<string, Error>> {
    try {
      await this.db
        .insertInto('lot_disposals')
        .values({
          id: disposal.id,
          lot_id: disposal.lotId,
          disposal_transaction_id: disposal.disposalTransactionId,
          quantity_disposed: disposal.quantityDisposed.toFixed(),
          proceeds_per_unit: disposal.proceedsPerUnit.toFixed(),
          total_proceeds: disposal.totalProceeds.toFixed(),
          cost_basis_per_unit: disposal.costBasisPerUnit.toFixed(),
          total_cost_basis: disposal.totalCostBasis.toFixed(),
          gain_loss: disposal.gainLoss.toFixed(),
          disposal_date: disposal.disposalDate.toISOString(),
          holding_period_days: disposal.holdingPeriodDays,
          tax_treatment_category: disposal.taxTreatmentCategory ?? null,
          created_at: disposal.createdAt.toISOString(),
          metadata_json: this.serializeToJson(disposal.metadata) ?? null,
        })
        .execute();

      this.logger.debug({ disposalId: disposal.id }, 'Created lot disposal');
      return ok(disposal.id);
    } catch (error) {
      this.logger.error({ error }, 'Failed to create lot disposal');
      return wrapError(error, 'Failed to create lot disposal');
    }
  }

  /**
   * Bulk create lot disposals
   */
  async createDisposalsBulk(disposals: LotDisposal[]): Promise<Result<number, Error>> {
    try {
      if (disposals.length === 0) {
        return ok(0);
      }

      const values = disposals.map((disposal) => ({
        id: disposal.id,
        lot_id: disposal.lotId,
        disposal_transaction_id: disposal.disposalTransactionId,
        quantity_disposed: disposal.quantityDisposed.toFixed(),
        proceeds_per_unit: disposal.proceedsPerUnit.toFixed(),
        total_proceeds: disposal.totalProceeds.toFixed(),
        cost_basis_per_unit: disposal.costBasisPerUnit.toFixed(),
        total_cost_basis: disposal.totalCostBasis.toFixed(),
        gain_loss: disposal.gainLoss.toFixed(),
        disposal_date: disposal.disposalDate.toISOString(),
        holding_period_days: disposal.holdingPeriodDays,
        tax_treatment_category: disposal.taxTreatmentCategory ?? null,
        created_at: disposal.createdAt.toISOString(),
        metadata_json: this.serializeToJson(disposal.metadata) ?? null,
      }));

      await this.db.insertInto('lot_disposals').values(values).execute();

      this.logger.info({ count: disposals.length }, 'Bulk created lot disposals');
      return ok(disposals.length);
    } catch (error) {
      this.logger.error({ error }, 'Failed to bulk create lot disposals');
      return wrapError(error, 'Failed to bulk create lot disposals');
    }
  }

  /**
   * Find disposals by lot ID
   */
  async findDisposalsByLotId(lotId: string): Promise<Result<LotDisposal[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('lot_disposals')
        .selectAll()
        .where('lot_id', '=', lotId)
        .orderBy('disposal_date', 'asc')
        .execute();

      const disposals: LotDisposal[] = [];
      for (const row of rows) {
        const result = this.toLotDisposal(row as StoredLotDisposal);
        if (result.isErr()) {
          return err(result.error);
        }
        disposals.push(result.value);
      }

      return ok(disposals);
    } catch (error) {
      this.logger.error({ error, lotId }, 'Failed to find disposals by lot ID');
      return wrapError(error, 'Failed to find disposals by lot ID');
    }
  }

  /**
   * Find disposals by disposal transaction ID
   */
  async findDisposalsByTransactionId(transactionId: number): Promise<Result<LotDisposal[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('lot_disposals')
        .selectAll()
        .where('disposal_transaction_id', '=', transactionId)
        .execute();

      const disposals: LotDisposal[] = [];
      for (const row of rows) {
        const result = this.toLotDisposal(row as StoredLotDisposal);
        if (result.isErr()) {
          return err(result.error);
        }
        disposals.push(result.value);
      }

      return ok(disposals);
    } catch (error) {
      this.logger.error({ error, transactionId }, 'Failed to find disposals by transaction ID');
      return wrapError(error, 'Failed to find disposals by transaction ID');
    }
  }

  /**
   * Find all disposals for a calculation (via lot join)
   */
  async findDisposalsByCalculationId(calculationId: string): Promise<Result<LotDisposal[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('lot_disposals')
        .innerJoin('acquisition_lots', 'lot_disposals.lot_id', 'acquisition_lots.id')
        .selectAll('lot_disposals')
        .where('acquisition_lots.calculation_id', '=', calculationId)
        .orderBy('lot_disposals.disposal_date', 'asc')
        .execute();

      const disposals: LotDisposal[] = [];
      for (const row of rows) {
        const result = this.toLotDisposal(row as StoredLotDisposal);
        if (result.isErr()) {
          return err(result.error);
        }
        disposals.push(result.value);
      }

      return ok(disposals);
    } catch (error) {
      this.logger.error({ error, calculationId }, 'Failed to find disposals by calculation ID');
      return wrapError(error, 'Failed to find disposals by calculation ID');
    }
  }

  // ==================== COST BASIS CALCULATIONS ====================

  /**
   * Create a new cost basis calculation
   */
  async createCalculation(calculation: CostBasisCalculation): Promise<Result<string, Error>> {
    try {
      await this.db
        .insertInto('cost_basis_calculations')
        .values({
          id: calculation.id,
          calculation_date: calculation.calculationDate.toISOString(),
          config_json: this.serializeToJson(calculation.config) ?? '{}',
          start_date: calculation.startDate ? calculation.startDate.toISOString() : null,
          end_date: calculation.endDate ? calculation.endDate.toISOString() : null,
          total_proceeds: calculation.totalProceeds.toFixed(),
          total_cost_basis: calculation.totalCostBasis.toFixed(),
          total_gain_loss: calculation.totalGainLoss.toFixed(),
          total_taxable_gain_loss: calculation.totalTaxableGainLoss.toFixed(),
          assets_processed: this.serializeToJson(calculation.assetsProcessed) ?? '[]',
          transactions_processed: calculation.transactionsProcessed,
          lots_created: calculation.lotsCreated,
          disposals_processed: calculation.disposalsProcessed,
          status: calculation.status,
          error_message: calculation.errorMessage ?? null,
          created_at: calculation.createdAt.toISOString(),
          completed_at: calculation.completedAt ? calculation.completedAt.toISOString() : null,
          metadata_json: this.serializeToJson(calculation.metadata) ?? null,
        })
        .execute();

      this.logger.debug({ calculationId: calculation.id }, 'Created cost basis calculation');
      return ok(calculation.id);
    } catch (error) {
      this.logger.error({ error }, 'Failed to create cost basis calculation');
      return wrapError(error, 'Failed to create cost basis calculation');
    }
  }

  /**
   * Find calculation by ID
   */
  async findCalculationById(id: string): Promise<Result<CostBasisCalculation | null, Error>> {
    try {
      const row = await this.db
        .selectFrom('cost_basis_calculations')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();

      if (!row) {
        return ok(null);
      }

      const result = this.toCostBasisCalculation(row as StoredCostBasisCalculation);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      this.logger.error({ error, id }, 'Failed to find calculation by ID');
      return wrapError(error, 'Failed to find calculation by ID');
    }
  }

  /**
   * Find all calculations, ordered by date descending (newest first)
   */
  async findAllCalculations(): Promise<Result<CostBasisCalculation[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('cost_basis_calculations')
        .selectAll()
        .orderBy('calculation_date', 'desc')
        .execute();

      const calculations: CostBasisCalculation[] = [];
      for (const row of rows) {
        const result = this.toCostBasisCalculation(row as StoredCostBasisCalculation);
        if (result.isErr()) {
          return err(result.error);
        }
        calculations.push(result.value);
      }

      return ok(calculations);
    } catch (error) {
      this.logger.error({ error }, 'Failed to find all calculations');
      return wrapError(error, 'Failed to find all calculations');
    }
  }

  /**
   * Update calculation status and completion data
   */
  async updateCalculation(id: string, updates: Partial<CostBasisCalculation>): Promise<Result<boolean, Error>> {
    try {
      const updateValues: Record<string, unknown> = {};

      if (updates.status !== undefined) {
        updateValues['status'] = updates.status;
      }
      if (updates.completedAt !== undefined) {
        updateValues['completed_at'] = updates.completedAt.toISOString();
      }
      if (updates.errorMessage !== undefined) {
        updateValues['error_message'] = updates.errorMessage;
      }
      if (updates.totalProceeds !== undefined) {
        updateValues['total_proceeds'] = updates.totalProceeds.toFixed();
      }
      if (updates.totalCostBasis !== undefined) {
        updateValues['total_cost_basis'] = updates.totalCostBasis.toFixed();
      }
      if (updates.totalGainLoss !== undefined) {
        updateValues['total_gain_loss'] = updates.totalGainLoss.toFixed();
      }
      if (updates.totalTaxableGainLoss !== undefined) {
        updateValues['total_taxable_gain_loss'] = updates.totalTaxableGainLoss.toFixed();
      }
      if (updates.transactionsProcessed !== undefined) {
        updateValues['transactions_processed'] = updates.transactionsProcessed;
      }
      if (updates.lotsCreated !== undefined) {
        updateValues['lots_created'] = updates.lotsCreated;
      }
      if (updates.disposalsProcessed !== undefined) {
        updateValues['disposals_processed'] = updates.disposalsProcessed;
      }
      if (updates.assetsProcessed !== undefined) {
        updateValues['assets_processed'] = this.serializeToJson(updates.assetsProcessed) ?? '[]';
      }

      const result = await this.db
        .updateTable('cost_basis_calculations')
        .set(updateValues)
        .where('id', '=', id)
        .execute();

      const updated = result[0] ? Number(result[0].numUpdatedRows ?? 0) > 0 : false;
      this.logger.debug({ calculationId: id, updated }, 'Updated cost basis calculation');
      return ok(updated);
    } catch (error) {
      this.logger.error({ error, id }, 'Failed to update cost basis calculation');
      return wrapError(error, 'Failed to update cost basis calculation');
    }
  }

  // ==================== COUNT OPERATIONS ====================

  /**
   * Count all acquisition lots
   */
  async countAllLots(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .selectFrom('acquisition_lots')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      this.logger.error({ error }, 'Failed to count all acquisition lots');
      return wrapError(error, 'Failed to count all acquisition lots');
    }
  }

  /**
   * Count acquisition lots by account IDs
   * Counts lots where acquisition transactions belong to the specified accounts
   * Filters WHERE acquisition_transaction_id IN (SELECT id FROM transactions WHERE account_id IN (accountIds))
   */
  async countLotsByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      const result = await this.db
        .selectFrom('acquisition_lots')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .where(
          'acquisition_transaction_id',
          'in',
          this.db.selectFrom('transactions').select('id').where('account_id', 'in', accountIds)
        )
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to count lots by account IDs');
      return wrapError(error, 'Failed to count lots by account IDs');
    }
  }

  /**
   * Count all lot disposals
   */
  async countAllDisposals(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .selectFrom('lot_disposals')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      this.logger.error({ error }, 'Failed to count all lot disposals');
      return wrapError(error, 'Failed to count all lot disposals');
    }
  }

  /**
   * Count lot disposals by account IDs
   * Counts disposals from lots where acquisition transactions belong to the specified accounts
   * Filters WHERE lot_id IN (SELECT id FROM acquisition_lots WHERE acquisition_transaction_id IN (SELECT id FROM transactions WHERE account_id IN (accountIds)))
   */
  async countDisposalsByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      const result = await this.db
        .selectFrom('lot_disposals')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .where(
          'lot_id',
          'in',
          this.db
            .selectFrom('acquisition_lots')
            .select('id')
            .where(
              'acquisition_transaction_id',
              'in',
              this.db.selectFrom('transactions').select('id').where('account_id', 'in', accountIds)
            )
        )
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to count disposals by account IDs');
      return wrapError(error, 'Failed to count disposals by account IDs');
    }
  }

  /**
   * Count all cost basis calculations
   */
  async countAllCalculations(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .selectFrom('cost_basis_calculations')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      this.logger.error({ error }, 'Failed to count all cost basis calculations');
      return wrapError(error, 'Failed to count all cost basis calculations');
    }
  }

  /**
   * Count cost basis calculations by account IDs
   * Counts distinct calculations that have lots from transactions belonging to the specified accounts
   * Counts DISTINCT calculation_id WHERE acquisition_transaction_id IN (SELECT id FROM transactions WHERE account_id IN (accountIds))
   */
  async countCalculationsByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      // Count distinct calculation IDs that have lots referencing the accounts
      const calculationIds = await this.db
        .selectFrom('acquisition_lots')
        .select('calculation_id')
        .distinct()
        .where(
          'acquisition_transaction_id',
          'in',
          this.db.selectFrom('transactions').select('id').where('account_id', 'in', accountIds)
        )
        .execute();

      return ok(calculationIds.length);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to count calculations by account IDs');
      return wrapError(error, 'Failed to count calculations by account IDs');
    }
  }

  // ==================== DELETE OPERATIONS ====================

  /**
   * Delete all lot disposals for transactions from a specific source
   */
  async deleteDisposalsBySource(sourceName: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .deleteFrom('lot_disposals')
        .where(
          'lot_id',
          'in',
          this.db
            .selectFrom('acquisition_lots')
            .select('id')
            .where(
              'acquisition_transaction_id',
              'in',
              this.db.selectFrom('transactions').select('id').where('source_name', '=', sourceName)
            )
        )
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ sourceName, count }, 'Deleted lot disposals by source');
      return ok(count);
    } catch (error) {
      this.logger.error({ error, sourceName }, 'Failed to delete lot disposals by source');
      return wrapError(error, 'Failed to delete lot disposals by source');
    }
  }

  /**
   * Delete lot disposals by account IDs
   * Deletes disposals from lots where acquisition transactions belong to the specified accounts
   * Deletes WHERE lot_id IN (SELECT id FROM acquisition_lots WHERE acquisition_transaction_id IN (SELECT id FROM transactions WHERE account_id IN (accountIds)))
   */
  async deleteDisposalsByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      const result = await this.db
        .deleteFrom('lot_disposals')
        .where(
          'lot_id',
          'in',
          this.db
            .selectFrom('acquisition_lots')
            .select('id')
            .where(
              'acquisition_transaction_id',
              'in',
              this.db.selectFrom('transactions').select('id').where('account_id', 'in', accountIds)
            )
        )
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ accountIds, count }, 'Deleted lot disposals by account IDs');
      return ok(count);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to delete lot disposals by account IDs');
      return wrapError(error, 'Failed to delete lot disposals by account IDs');
    }
  }

  /**
   * Delete all acquisition lots for transactions from a specific source
   */
  async deleteLotsBySource(sourceName: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .deleteFrom('acquisition_lots')
        .where(
          'acquisition_transaction_id',
          'in',
          this.db.selectFrom('transactions').select('id').where('source_name', '=', sourceName)
        )
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ sourceName, count }, 'Deleted acquisition lots by source');
      return ok(count);
    } catch (error) {
      this.logger.error({ error, sourceName }, 'Failed to delete acquisition lots by source');
      return wrapError(error, 'Failed to delete acquisition lots by source');
    }
  }

  /**
   * Delete acquisition lots by account IDs
   * Deletes lots where acquisition transactions belong to the specified accounts
   * Deletes WHERE acquisition_transaction_id IN (SELECT id FROM transactions WHERE account_id IN (accountIds))
   */
  async deleteLotsByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      const result = await this.db
        .deleteFrom('acquisition_lots')
        .where(
          'acquisition_transaction_id',
          'in',
          this.db.selectFrom('transactions').select('id').where('account_id', 'in', accountIds)
        )
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ accountIds, count }, 'Deleted acquisition lots by account IDs');
      return ok(count);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to delete acquisition lots by account IDs');
      return wrapError(error, 'Failed to delete acquisition lots by account IDs');
    }
  }

  /**
   * Delete all lot disposals
   */
  async deleteAllDisposals(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('lot_disposals').executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ count }, 'Deleted all lot disposals');
      return ok(count);
    } catch (error) {
      this.logger.error({ error }, 'Failed to delete all lot disposals');
      return wrapError(error, 'Failed to delete all lot disposals');
    }
  }

  /**
   * Delete all acquisition lots
   */
  async deleteAllLots(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('acquisition_lots').executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ count }, 'Deleted all acquisition lots');
      return ok(count);
    } catch (error) {
      this.logger.error({ error }, 'Failed to delete all acquisition lots');
      return wrapError(error, 'Failed to delete all acquisition lots');
    }
  }

  /**
   * Delete all cost basis calculations
   */
  async deleteAllCalculations(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('cost_basis_calculations').executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ count }, 'Deleted all cost basis calculations');
      return ok(count);
    } catch (error) {
      this.logger.error({ error }, 'Failed to delete all cost basis calculations');
      return wrapError(error, 'Failed to delete all cost basis calculations');
    }
  }

  /**
   * Delete cost basis calculations by account IDs
   * Finds and deletes calculations that have lots from transactions belonging to the specified accounts
   * Deletes WHERE id IN (SELECT DISTINCT calculation_id FROM acquisition_lots WHERE acquisition_transaction_id IN (SELECT id FROM transactions WHERE account_id IN (accountIds)))
   */
  async deleteCalculationsByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      // Find calculation IDs that have lots referencing the accounts
      const calculationIds = await this.db
        .selectFrom('acquisition_lots')
        .select('calculation_id')
        .distinct()
        .where(
          'acquisition_transaction_id',
          'in',
          this.db.selectFrom('transactions').select('id').where('account_id', 'in', accountIds)
        )
        .execute();

      if (calculationIds.length === 0) {
        return ok(0);
      }

      const ids = calculationIds.map((row) => row.calculation_id);

      // Delete calculations with those IDs
      const result = await this.db.deleteFrom('cost_basis_calculations').where('id', 'in', ids).executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ accountIds, count }, 'Deleted cost basis calculations by account IDs');
      return ok(count);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to delete calculations by account IDs');
      return wrapError(error, 'Failed to delete calculations by account IDs');
    }
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Convert database row to AcquisitionLot domain model
   */
  private toAcquisitionLot(row: StoredAcquisitionLot): Result<AcquisitionLot, Error> {
    try {
      const metadata = this.parseWithSchema(row.metadata_json, AcquisitionLotSchema.shape.metadata);
      if (metadata.isErr()) {
        return err(metadata.error);
      }

      return ok({
        id: row.id,
        calculationId: row.calculation_id,
        acquisitionTransactionId: row.acquisition_transaction_id,
        assetSymbol: row.asset,
        quantity: DecimalSchema.parse(row.quantity),
        costBasisPerUnit: DecimalSchema.parse(row.cost_basis_per_unit),
        totalCostBasis: DecimalSchema.parse(row.total_cost_basis),
        acquisitionDate: new Date(row.acquisition_date),
        method: row.method,
        remainingQuantity: DecimalSchema.parse(row.remaining_quantity),
        status: row.status,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        metadata: metadata.value,
      });
    } catch (error) {
      this.logger.error({ error, row }, 'Failed to convert row to AcquisitionLot');
      return wrapError(error, 'Failed to convert row to AcquisitionLot');
    }
  }

  /**
   * Convert database row to LotDisposal domain model
   */
  private toLotDisposal(row: StoredLotDisposal): Result<LotDisposal, Error> {
    try {
      const metadata = this.parseWithSchema(row.metadata_json, LotDisposalSchema.shape.metadata);
      if (metadata.isErr()) {
        return err(metadata.error);
      }

      return ok({
        id: row.id,
        lotId: row.lot_id,
        disposalTransactionId: row.disposal_transaction_id,
        quantityDisposed: DecimalSchema.parse(row.quantity_disposed),
        proceedsPerUnit: DecimalSchema.parse(row.proceeds_per_unit),
        totalProceeds: DecimalSchema.parse(row.total_proceeds),
        costBasisPerUnit: DecimalSchema.parse(row.cost_basis_per_unit),
        totalCostBasis: DecimalSchema.parse(row.total_cost_basis),
        gainLoss: DecimalSchema.parse(row.gain_loss),
        disposalDate: new Date(row.disposal_date),
        holdingPeriodDays: row.holding_period_days,
        taxTreatmentCategory: row.tax_treatment_category ?? undefined,
        createdAt: new Date(row.created_at),
        metadata: metadata.value,
      });
    } catch (error) {
      this.logger.error({ error, row }, 'Failed to convert row to LotDisposal');
      return wrapError(error, 'Failed to convert row to LotDisposal');
    }
  }

  /**
   * Convert database row to CostBasisCalculation domain model
   */
  private toCostBasisCalculation(row: StoredCostBasisCalculation): Result<CostBasisCalculation, Error> {
    try {
      const configResult = this.parseWithSchema(row.config_json, CostBasisCalculationSchema.shape.config);
      if (configResult.isErr()) {
        return err(configResult.error);
      }
      if (configResult.value === undefined) {
        return err(new Error('config_json is required but was undefined'));
      }

      const assetsProcessedResult = this.parseWithSchema(
        row.assets_processed,
        CostBasisCalculationSchema.shape.assetsProcessed
      );
      if (assetsProcessedResult.isErr()) {
        return err(assetsProcessedResult.error);
      }

      const metadataResult = this.parseWithSchema(row.metadata_json, CostBasisCalculationSchema.shape.metadata);
      if (metadataResult.isErr()) {
        return err(metadataResult.error);
      }

      return ok({
        id: row.id,
        calculationDate: new Date(row.calculation_date),
        config: configResult.value,
        startDate: row.start_date ? new Date(row.start_date) : undefined,
        endDate: row.end_date ? new Date(row.end_date) : undefined,
        totalProceeds: DecimalSchema.parse(row.total_proceeds),
        totalCostBasis: DecimalSchema.parse(row.total_cost_basis),
        totalGainLoss: DecimalSchema.parse(row.total_gain_loss),
        totalTaxableGainLoss: DecimalSchema.parse(row.total_taxable_gain_loss),
        assetsProcessed: assetsProcessedResult.value ?? [],
        transactionsProcessed: row.transactions_processed,
        lotsCreated: row.lots_created,
        disposalsProcessed: row.disposals_processed,
        status: row.status,
        errorMessage: row.error_message ?? undefined,
        createdAt: new Date(row.created_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
        metadata: metadataResult.value,
      });
    } catch (error) {
      this.logger.error({ error, row }, 'Failed to convert row to CostBasisCalculation');
      return wrapError(error, 'Failed to convert row to CostBasisCalculation');
    }
  }
}
