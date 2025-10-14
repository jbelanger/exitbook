import type { KyselyDB } from '@exitbook/data';
import { getLogger, type Logger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

/**
 * Repository for cost basis data operations
 * Handles acquisition_lots, lot_disposals, and cost_basis_calculations tables
 */
export class CostBasisRepository {
  private readonly db: KyselyDB;
  private readonly logger: Logger;

  constructor(db: KyselyDB) {
    this.db = db;
    this.logger = getLogger('CostBasisRepository');
  }

  /**
   * Delete all lot disposals for transactions from a specific source
   */
  async deleteDisposalsBySource(sourceId: string): Promise<Result<number, Error>> {
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
              this.db.selectFrom('transactions').select('id').where('source_id', '=', sourceId)
            )
        )
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ sourceId, count }, 'Deleted lot disposals by source');
      return ok(count);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, sourceId }, 'Failed to delete lot disposals by source');
      return err(new Error(`Failed to delete lot disposals by source: ${message}`));
    }
  }

  /**
   * Delete all acquisition lots for transactions from a specific source
   */
  async deleteLotsBySource(sourceId: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .deleteFrom('acquisition_lots')
        .where(
          'acquisition_transaction_id',
          'in',
          this.db.selectFrom('transactions').select('id').where('source_id', '=', sourceId)
        )
        .executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.debug({ sourceId, count }, 'Deleted acquisition lots by source');
      return ok(count);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error, sourceId }, 'Failed to delete acquisition lots by source');
      return err(new Error(`Failed to delete acquisition lots by source: ${message}`));
    }
  }

  /**
   * Delete all lot disposals
   */
  async deleteAllDisposals(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('lot_disposals').executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.info({ count }, 'Deleted all lot disposals');
      return ok(count);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error }, 'Failed to delete all lot disposals');
      return err(new Error(`Failed to delete all lot disposals: ${message}`));
    }
  }

  /**
   * Delete all acquisition lots
   */
  async deleteAllLots(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('acquisition_lots').executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.info({ count }, 'Deleted all acquisition lots');
      return ok(count);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error }, 'Failed to delete all acquisition lots');
      return err(new Error(`Failed to delete all acquisition lots: ${message}`));
    }
  }

  /**
   * Delete all cost basis calculations
   */
  async deleteAllCalculations(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('cost_basis_calculations').executeTakeFirst();

      const count = Number(result.numDeletedRows ?? 0);
      this.logger.info({ count }, 'Deleted all cost basis calculations');
      return ok(count);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error({ error }, 'Failed to delete all cost basis calculations');
      return err(new Error(`Failed to delete all cost basis calculations: ${message}`));
    }
  }
}
