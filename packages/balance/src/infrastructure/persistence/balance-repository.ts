import type { StoredTransaction } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';

/**
 * Kysely-based repository for balance database operations.
 * Handles storage and retrieval of balance snapshots and verification records using type-safe queries.
 */
export class BalanceRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'BalanceRepository');
  }

  async getTransactionsForCalculation(source: string): Promise<StoredTransaction[]> {
    const rows = (await this.db
      .selectFrom('transactions')
      .select([
        'source_id',
        'movements_inflows',
        'movements_outflows',
        'movements_primary_asset',
        'movements_primary_amount',
        'movements_primary_currency',
        'movements_primary_direction',
        'fees_network',
        'fees_platform',
        'fees_total',
        'operation_category',
        'operation_type',
      ])
      .where('source_id', '=', source)
      .orderBy('transaction_datetime', 'asc')
      .execute()) as StoredTransaction[];

    return rows;
  }
}
