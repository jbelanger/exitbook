import type { StoredTransaction as _StoredTransaction } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import type { Decimal } from 'decimal.js';
import { err, ok } from 'neverthrow';

// Local utility function to convert Money type to database string
function moneyToDbString(money: { amount: Decimal | number; currency: string }): string {
  if (typeof money.amount === 'number') {
    return String(money.amount);
  }
  return money.amount.toString();
}

/**
 * Kysely-based repository for transaction database operations.
 * Handles storage and retrieval of UniversalTransaction entities using type-safe queries.
 */
export class TransactionRepository extends BaseRepository implements ITransactionRepository {
  constructor(db: KyselyDB) {
    super(db, 'TransactionRepository');
  }

  async save(transaction: UniversalTransaction, importSessionId: number) {
    return this.saveTransaction(transaction, importSessionId);
  }

  async saveTransaction(transaction: UniversalTransaction, importSessionId: number) {
    try {
      const rawDataJson = this.serializeToJson(transaction) ?? '{}';

      // Extract currencies from Money type
      let priceCurrency: string | undefined;

      if (transaction.price && typeof transaction.price === 'object' && transaction.price.currency) {
        priceCurrency = transaction.price.currency;
      }

      const result = await this.db
        .insertInto('transactions')
        .values({
          created_at: this.getCurrentDateTimeForDB(),
          external_id: (transaction.metadata?.hash ||
            transaction.source + '-' + (transaction.id || 'unknown')) as string,
          from_address: transaction.from,
          import_session_id: importSessionId,
          note_message: transaction.note?.message,
          note_metadata: transaction.note?.metadata ? this.serializeToJson(transaction.note.metadata) : undefined,
          note_severity: transaction.note?.severity,
          note_type: transaction.note?.type,
          price:
            typeof transaction.price === 'object'
              ? moneyToDbString(transaction.price)
              : transaction.price
                ? String(transaction.price)
                : undefined,
          price_currency: priceCurrency,
          raw_normalized_data: rawDataJson,
          source_id: transaction.source,
          source_type: transaction.blockchain ? 'blockchain' : 'exchange',
          to_address: transaction.to,
          transaction_datetime: transaction.datetime
            ? new Date(transaction.datetime).toISOString()
            : new Date().toISOString(),
          transaction_status: (transaction.status as 'pending' | 'confirmed' | 'failed' | 'cancelled') || 'confirmed',
          verified: Boolean(transaction.metadata?.verified),

          // Structured movements
          movements_inflows: transaction.movements?.inflows
            ? this.serializeToJson(transaction.movements.inflows)
            : undefined,
          movements_outflows: transaction.movements?.outflows
            ? this.serializeToJson(transaction.movements.outflows)
            : undefined,
          movements_primary_asset: transaction.movements?.primary.asset,
          movements_primary_amount: transaction.movements?.primary.amount
            ? moneyToDbString(transaction.movements.primary.amount)
            : undefined,
          movements_primary_currency: transaction.movements?.primary.amount?.currency,
          movements_primary_direction: transaction.movements?.primary.direction,

          // Structured fees
          fees_network: transaction.fees?.network ? this.serializeToJson(transaction.fees.network) : undefined,
          fees_platform: transaction.fees?.platform ? this.serializeToJson(transaction.fees.platform) : undefined,
          fees_total: transaction.fees?.total ? this.serializeToJson(transaction.fees.total) : undefined,

          // Enhanced operation classification
          operation_category: transaction.operation?.category,
          operation_type: transaction.operation?.type,

          // Blockchain metadata
          blockchain_name: transaction.blockchain?.name,
          blockchain_block_height: transaction.blockchain?.block_height,
          blockchain_transaction_hash: transaction.blockchain?.transaction_hash,
          blockchain_is_confirmed: transaction.blockchain?.is_confirmed,
        })
        .onConflict((oc) =>
          oc.doUpdateSet({
            from_address: (eb) => eb.ref('excluded.from_address'),
            note_message: (eb) => eb.ref('excluded.note_message'),
            note_metadata: (eb) => eb.ref('excluded.note_metadata'),
            note_severity: (eb) => eb.ref('excluded.note_severity'),
            note_type: (eb) => eb.ref('excluded.note_type'),
            price: (eb) => eb.ref('excluded.price'),
            price_currency: (eb) => eb.ref('excluded.price_currency'),
            raw_normalized_data: (eb) => eb.ref('excluded.raw_normalized_data'),
            to_address: (eb) => eb.ref('excluded.to_address'),
            transaction_datetime: (eb) => eb.ref('excluded.transaction_datetime'),
            transaction_status: (eb) => eb.ref('excluded.transaction_status'),
            updated_at: new Date().toISOString(),
            verified: (eb) => eb.ref('excluded.verified'),

            // Structured movements
            movements_inflows: (eb) => eb.ref('excluded.movements_inflows'),
            movements_outflows: (eb) => eb.ref('excluded.movements_outflows'),
            movements_primary_asset: (eb) => eb.ref('excluded.movements_primary_asset'),
            movements_primary_amount: (eb) => eb.ref('excluded.movements_primary_amount'),
            movements_primary_currency: (eb) => eb.ref('excluded.movements_primary_currency'),
            movements_primary_direction: (eb) => eb.ref('excluded.movements_primary_direction'),

            // Structured fees
            fees_network: (eb) => eb.ref('excluded.fees_network'),
            fees_platform: (eb) => eb.ref('excluded.fees_platform'),
            fees_total: (eb) => eb.ref('excluded.fees_total'),

            // Enhanced operation classification
            operation_category: (eb) => eb.ref('excluded.operation_category'),
            operation_type: (eb) => eb.ref('excluded.operation_type'),

            // Blockchain metadata
            blockchain_name: (eb) => eb.ref('excluded.blockchain_name'),
            blockchain_block_height: (eb) => eb.ref('excluded.blockchain_block_height'),
            blockchain_transaction_hash: (eb) => eb.ref('excluded.blockchain_transaction_hash'),
            blockchain_is_confirmed: (eb) => eb.ref('excluded.blockchain_is_confirmed'),
          })
        )
        .returning('id')
        .executeTakeFirstOrThrow();

      return ok(result.id);
    } catch (error) {
      this.logger.error(
        { error, transaction: { source: transaction.source, operation: transaction.operation } },
        'Failed to save transaction'
      );
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getTransactions(sourceId?: string, since?: number) {
    try {
      let query = this.db.selectFrom('transactions').selectAll();

      // Add WHERE conditions if provided
      if (sourceId) {
        query = query.where('source_id', '=', sourceId);
      }

      if (since) {
        // Convert Unix timestamp to ISO string for comparison
        const sinceDate = new Date(since * 1000).toISOString();
        query = query.where('created_at', '>=', sinceDate as unknown as string);
      }

      // Order by creation time descending
      query = query.orderBy('created_at', 'desc');

      const transactions = await query.execute();

      return ok(transactions);
    } catch (error) {
      this.logger.error({ error, since, sourceId }, 'Failed to retrieve transactions');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async findByAddress(address: string) {
    try {
      const transactions = await this.db
        .selectFrom('transactions')
        .selectAll()
        .where((eb) => eb.or([eb('from_address', '=', address), eb('to_address', '=', address)]))
        .orderBy('transaction_datetime', 'desc')
        .execute();

      return ok(transactions);
    } catch (error) {
      this.logger.error({ address, error }, 'Failed to retrieve transactions by address');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async findRecent(address: string, limit: number) {
    try {
      const transactions = await this.db
        .selectFrom('transactions')
        .selectAll()
        .where((eb) => eb.or([eb('from_address', '=', address), eb('to_address', '=', address)]))
        .orderBy('transaction_datetime', 'desc')
        .limit(limit)
        .execute();

      return ok(transactions);
    } catch (error) {
      this.logger.error({ address, error, limit }, 'Failed to retrieve recent transactions by address');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async findByDateRange(address: string, from: Date, to: Date) {
    try {
      const transactions = await this.db
        .selectFrom('transactions')
        .selectAll()
        .where((eb) =>
          eb.and([
            eb.or([eb('from_address', '=', address), eb('to_address', '=', address)]),
            eb('transaction_datetime', '>=', from.toISOString()),
            eb('transaction_datetime', '<=', to.toISOString()),
          ])
        )
        .orderBy('transaction_datetime', 'desc')
        .execute();

      return ok(transactions);
    } catch (error) {
      this.logger.error({ address, error, from, to }, 'Failed to retrieve transactions by date range');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async getTransactionCount(sourceId?: string) {
    try {
      let query = this.db.selectFrom('transactions').select((eb) => eb.fn.count<number>('id').as('count'));

      if (sourceId) {
        query = query.where('source_id', '=', sourceId);
      }

      const result = await query.executeTakeFirstOrThrow();

      return ok(result.count);
    } catch (error) {
      this.logger.error({ error, sourceId }, 'Failed to get transaction count');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
