/* eslint-disable unicorn/no-null -- null needed by Kysely */
import { DecimalSchema, wrapError } from '@exitbook/core';
import { BaseRepository, type KyselyDB } from '@exitbook/data';
import type { Selectable } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { LotTransferSchema, type LotTransfer } from '../domain/schemas.js';

type StoredLotTransfer = Selectable<{
  calculation_id: string;
  cost_basis_per_unit: string;
  created_at: string;
  id: string;
  link_id: string;
  metadata_json: string | null;
  quantity_transferred: string;
  source_lot_id: string;
  source_transaction_id: number;
  target_transaction_id: number;
}>;

/**
 * Repository for lot transfer data operations
 * Handles lot_transfers table for tracking cost basis transfers via transaction links
 */
export class LotTransferRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'LotTransferRepository');
  }

  /**
   * Create a new lot transfer
   */
  async create(transfer: LotTransfer): Promise<Result<void, Error>> {
    try {
      await this.db
        .insertInto('lot_transfers')
        .values({
          id: transfer.id,
          calculation_id: transfer.calculationId,
          source_lot_id: transfer.sourceLotId,
          link_id: transfer.linkId,
          quantity_transferred: transfer.quantityTransferred.toFixed(),
          cost_basis_per_unit: transfer.costBasisPerUnit.toFixed(),
          source_transaction_id: transfer.sourceTransactionId,
          target_transaction_id: transfer.targetTransactionId,
          created_at: transfer.createdAt.toISOString(),
          metadata_json: this.serializeToJson(transfer.metadata) ?? null,
        })
        .execute();

      this.logger.debug({ transferId: transfer.id }, 'Created lot transfer');
      return ok(undefined);
    } catch (error) {
      this.logger.error({ error }, 'Failed to create lot transfer');
      return wrapError(error, 'Failed to create lot transfer');
    }
  }

  /**
   * Bulk create lot transfers
   */
  async createBulk(transfers: LotTransfer[]): Promise<Result<number, Error>> {
    try {
      if (transfers.length === 0) {
        return ok(0);
      }

      const values = transfers.map((transfer) => ({
        id: transfer.id,
        calculation_id: transfer.calculationId,
        source_lot_id: transfer.sourceLotId,
        link_id: transfer.linkId,
        quantity_transferred: transfer.quantityTransferred.toFixed(),
        cost_basis_per_unit: transfer.costBasisPerUnit.toFixed(),
        source_transaction_id: transfer.sourceTransactionId,
        target_transaction_id: transfer.targetTransactionId,
        created_at: transfer.createdAt.toISOString(),
        metadata_json: this.serializeToJson(transfer.metadata) ?? null,
      }));

      await this.db.insertInto('lot_transfers').values(values).execute();

      this.logger.info({ count: transfers.length }, 'Bulk created lot transfers');
      return ok(transfers.length);
    } catch (error) {
      this.logger.error({ error }, 'Failed to bulk create lot transfers');
      return wrapError(error, 'Failed to bulk create lot transfers');
    }
  }

  /**
   * Get all transfers for a calculation
   */
  async getByCalculationId(calculationId: string): Promise<Result<LotTransfer[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('lot_transfers')
        .selectAll()
        .where('calculation_id', '=', calculationId)
        .orderBy('created_at', 'asc')
        .execute();

      const transfers: LotTransfer[] = [];
      for (const row of rows) {
        const result = this.toLotTransfer(row as StoredLotTransfer);
        if (result.isErr()) {
          return err(result.error);
        }
        transfers.push(result.value);
      }

      return ok(transfers);
    } catch (error) {
      this.logger.error({ error, calculationId }, 'Failed to get transfers by calculation ID');
      return wrapError(error, 'Failed to get transfers by calculation ID');
    }
  }

  /**
   * Get transfers for a specific link
   */
  async getByLinkId(linkId: string): Promise<Result<LotTransfer[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('lot_transfers')
        .selectAll()
        .where('link_id', '=', linkId)
        .orderBy('created_at', 'asc')
        .execute();

      const transfers: LotTransfer[] = [];
      for (const row of rows) {
        const result = this.toLotTransfer(row as StoredLotTransfer);
        if (result.isErr()) {
          return err(result.error);
        }
        transfers.push(result.value);
      }

      return ok(transfers);
    } catch (error) {
      this.logger.error({ error, linkId }, 'Failed to get transfers by link ID');
      return wrapError(error, 'Failed to get transfers by link ID');
    }
  }

  /**
   * Get transfers from a source lot
   */
  async getBySourceLot(sourceLotId: string): Promise<Result<LotTransfer[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('lot_transfers')
        .selectAll()
        .where('source_lot_id', '=', sourceLotId)
        .orderBy('created_at', 'asc')
        .execute();

      const transfers: LotTransfer[] = [];
      for (const row of rows) {
        const result = this.toLotTransfer(row as StoredLotTransfer);
        if (result.isErr()) {
          return err(result.error);
        }
        transfers.push(result.value);
      }

      return ok(transfers);
    } catch (error) {
      this.logger.error({ error, sourceLotId }, 'Failed to get transfers by source lot');
      return wrapError(error, 'Failed to get transfers by source lot');
    }
  }

  /**
   * Count all lot transfers
   */
  async countAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .selectFrom('lot_transfers')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      this.logger.error({ error }, 'Failed to count all lot transfers');
      return wrapError(error, 'Failed to count all lot transfers');
    }
  }

  /**
   * Count lot transfers by account IDs
   * Counts transfers where source OR target transactions belong to the specified accounts,
   * or where the source lot's acquisition transaction belongs to the specified accounts
   * Filters WHERE source_transaction_id IN (...) OR target_transaction_id IN (...) OR source_lot_id IN (...)
   */
  async countByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      const transactionsSubquery = this.db
        .selectFrom('transactions')
        .select('id')
        .where('account_id', 'in', accountIds);

      const lotsSubquery = this.db
        .selectFrom('acquisition_lots')
        .select('id')
        .where('acquisition_transaction_id', 'in', transactionsSubquery);

      const result = await this.db
        .selectFrom('lot_transfers')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .where((eb) =>
          eb.or([
            eb('source_transaction_id', 'in', transactionsSubquery),
            eb('target_transaction_id', 'in', transactionsSubquery),
            eb('source_lot_id', 'in', lotsSubquery),
          ])
        )
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to count lot transfers by account IDs');
      return wrapError(error, 'Failed to count lot transfers by account IDs');
    }
  }

  /**
   * Delete all transfers for a calculation
   */
  async deleteByCalculationId(calculationId: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .deleteFrom('lot_transfers')
        .where('calculation_id', '=', calculationId)
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ calculationId, count }, 'Deleted lot transfers by calculation ID');
      return ok(count);
    } catch (error) {
      this.logger.error({ error, calculationId }, 'Failed to delete transfers by calculation ID');
      return wrapError(error, 'Failed to delete transfers by calculation ID');
    }
  }

  /**
   * Delete lot transfers by account IDs
   * Deletes transfers where source OR target transactions belong to the specified accounts,
   * or where the source lot's acquisition transaction belongs to the specified accounts
   * Deletes WHERE source_transaction_id IN (...) OR target_transaction_id IN (...) OR source_lot_id IN (...)
   */
  async deleteByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      const transactionsSubquery = this.db
        .selectFrom('transactions')
        .select('id')
        .where('account_id', 'in', accountIds);

      const lotsSubquery = this.db
        .selectFrom('acquisition_lots')
        .select('id')
        .where('acquisition_transaction_id', 'in', transactionsSubquery);

      const result = await this.db
        .deleteFrom('lot_transfers')
        .where((eb) =>
          eb.or([
            eb('source_transaction_id', 'in', transactionsSubquery),
            eb('target_transaction_id', 'in', transactionsSubquery),
            eb('source_lot_id', 'in', lotsSubquery),
          ])
        )
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ accountIds, count }, 'Deleted lot transfers by account IDs');
      return ok(count);
    } catch (error) {
      this.logger.error({ error, accountIds }, 'Failed to delete lot transfers by account IDs');
      return wrapError(error, 'Failed to delete lot transfers by account IDs');
    }
  }

  /**
   * Delete all lot transfers
   */
  async deleteAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('lot_transfers').executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ count }, 'Deleted all lot transfers');
      return ok(count);
    } catch (error) {
      this.logger.error({ error }, 'Failed to delete all lot transfers');
      return wrapError(error, 'Failed to delete all lot transfers');
    }
  }

  /**
   * Convert database row to LotTransfer domain model
   */
  private toLotTransfer(row: StoredLotTransfer): Result<LotTransfer, Error> {
    try {
      const metadata = this.parseWithSchema(row.metadata_json, LotTransferSchema.shape.metadata);
      if (metadata.isErr()) {
        return err(metadata.error);
      }

      return ok({
        id: row.id,
        calculationId: row.calculation_id,
        sourceLotId: row.source_lot_id,
        linkId: row.link_id,
        quantityTransferred: DecimalSchema.parse(row.quantity_transferred),
        costBasisPerUnit: DecimalSchema.parse(row.cost_basis_per_unit),
        sourceTransactionId: row.source_transaction_id,
        targetTransactionId: row.target_transaction_id,
        createdAt: new Date(row.created_at),
        metadata: metadata.value,
      });
    } catch (error) {
      this.logger.error({ error, row }, 'Failed to convert row to LotTransfer');
      return wrapError(error, 'Failed to convert row to LotTransfer');
    }
  }
}
