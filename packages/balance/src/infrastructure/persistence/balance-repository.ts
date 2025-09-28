import { BaseRepository as BaseRepository } from '@crypto/data/src/repositories/base-repository.ts';
import type { KyselyDB } from '@crypto/data/src/storage/database.ts';
import type { StoredTransaction } from '@crypto/data/src/types/data-types.ts';

import type { BalanceVerificationRecord } from '../../types/balance-types.ts';

/**
 * Maps database query result to BalanceVerificationRecord domain object
 */
function mapToBalanceVerificationRecord(row: Record<string, unknown>): BalanceVerificationRecord {
  return {
    actual_balance: parseFloat(row.actual_balance as string),
    created_at: new Date(row.created_at as string).getTime() / 1000,
    currency: row.currency as string,
    difference: parseFloat(row.difference as string),
    exchange: row.exchange as string,
    expected_balance: parseFloat(row.expected_balance as string),
    id: row.id as number,
    status: row.status as 'match' | 'mismatch' | 'warning',
    timestamp: new Date(row.verification_datetime as string).getTime() / 1000,
  };
}

/**
 * Maps database query result to StoredTransaction domain object for balance calculations
 */
function mapToStoredTransaction(row: Record<string, unknown>): StoredTransaction {
  return {
    amount: (row.amount as string) || undefined,
    amount_currency: row.amount_currency as string | undefined,
    created_at: '0', // Not needed for balance calculations
    external_id: undefined,
    fee_cost: row.fee_cost as string | undefined,
    fee_currency: row.fee_currency as string | undefined,
    from_address: undefined,
    id: 0, // Not needed for balance calculations
    import_session_id: undefined,
    note_message: undefined,
    note_metadata: undefined,
    note_severity: undefined,
    note_type: undefined,
    price: row.price as string | undefined,
    price_currency: row.price_currency as string | undefined,
    raw_data: row.raw_data as string,
    source_id: row.source_id as string,
    source_type: 'exchange',
    symbol: row.symbol as string | undefined,
    to_address: undefined,
    transaction_datetime: '0', // Not needed for balance calculations
    transaction_status: 'confirmed',
    transaction_type: row.transaction_type as
      | 'trade'
      | 'transfer'
      | 'deposit'
      | 'withdrawal'
      | 'fee'
      | 'reward'
      | 'mining',
    updated_at: undefined,
    verified: false,
    wallet_address_id: undefined,
  };
}

/**
 * Kysely-based repository for balance database operations.
 * Handles storage and retrieval of balance snapshots and verification records using type-safe queries.
 */
export class BalanceRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'BalanceRepository');
  }

  async getLatestVerifications(exchange?: string): Promise<BalanceVerificationRecord[]> {
    let query = this.db
      .selectFrom('balance_verifications as bv1')
      .selectAll()
      .where('verification_datetime', '=', (eb) =>
        eb
          .selectFrom('balance_verifications as bv2')
          .select((eb) => eb.fn.max('verification_datetime').as('max_verification_datetime'))
          .where('bv2.exchange', '=', eb.ref('bv1.exchange'))
          .where('bv2.currency', '=', eb.ref('bv1.currency'))
      );

    if (exchange) {
      query = query.where('exchange', '=', exchange);
    }

    query = query.orderBy('exchange').orderBy('currency');

    const rows = await query.execute();
    return rows.map(mapToBalanceVerificationRecord);
  }

  async getTransactionsForCalculation(exchange: string): Promise<StoredTransaction[]> {
    const rows = await this.db
      .selectFrom('transactions')
      .select([
        'source_id',
        'symbol',
        'transaction_type',
        'amount',
        'amount_currency',
        'price',
        'price_currency',
        'fee_cost',
        'fee_currency',
        'raw_data',
      ])
      .where('source_id', '=', exchange)
      .orderBy('transaction_datetime', 'asc')
      .execute();

    return rows.map(mapToStoredTransaction);
  }

  async saveVerification(verification: BalanceVerificationRecord): Promise<void> {
    await this.db
      .insertInto('balance_verifications')
      .values({
        actual_balance: verification.actual_balance.toString(),
        created_at: this.getCurrentDateTimeForDB(),
        currency: verification.currency,
        difference: verification.difference.toString(),
        exchange: verification.exchange,
        expected_balance: verification.expected_balance.toString(),
        status: verification.status as 'match' | 'mismatch' | 'warning',
        verification_datetime: new Date(verification.timestamp * 1000).toISOString(),
      })
      .execute();

    this.logger.debug(
      {
        currency: verification.currency,
        difference: verification.difference,
        exchange: verification.exchange,
        status: verification.status,
      },
      'Balance verification saved'
    );
  }
}
