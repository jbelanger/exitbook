import type { StoredTransaction } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { ITransactionRepository } from '@exitbook/import/app/ports/transaction-repository.js';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import type { Decimal } from 'decimal.js';

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

  async save(transaction: UniversalTransaction, importSessionId: number): Promise<number> {
    return this.saveTransaction(transaction, importSessionId);
  }

  async saveTransaction(transaction: UniversalTransaction, importSessionId: number): Promise<number> {
    try {
      const rawDataJson = this.serializeToJson(transaction) ?? '{}';

      // Extract currencies from Money type
      let amountCurrency: string | undefined;
      let priceCurrency: string | undefined;

      if (transaction.amount && typeof transaction.amount === 'object' && transaction.amount.currency) {
        amountCurrency = transaction.amount.currency;
      }

      if (transaction.price && typeof transaction.price === 'object' && transaction.price.currency) {
        priceCurrency = transaction.price.currency;
      }

      const result = await this.db
        .insertInto('transactions')
        .values({
          amount:
            typeof transaction.amount === 'object'
              ? moneyToDbString(transaction.amount)
              : transaction.amount
                ? String(transaction.amount)
                : undefined,
          amount_currency: amountCurrency,
          created_at: this.getCurrentDateTimeForDB(),
          external_id: (transaction.metadata?.hash ||
            transaction.source + '-' + (transaction.id || 'unknown')) as string,
          fee_cost: typeof transaction.fee === 'object' ? moneyToDbString(transaction.fee) : undefined,
          fee_currency: typeof transaction.fee === 'object' ? transaction.fee.currency : undefined,
          from_address: transaction.from || undefined,
          import_session_id: importSessionId,
          note_message: transaction.note?.message || undefined,
          note_metadata: transaction.note?.metadata ? this.serializeToJson(transaction.note.metadata) : undefined,
          note_severity: transaction.note?.severity || undefined,
          note_type: transaction.note?.type || undefined,
          price:
            typeof transaction.price === 'object'
              ? moneyToDbString(transaction.price)
              : transaction.price
                ? String(transaction.price)
                : undefined,
          price_currency: priceCurrency,
          raw_normalized_data: rawDataJson,
          source_id: transaction.source,
          source_type: 'exchange', // Default to exchange, can be overridden based on transaction source
          symbol: transaction.symbol || undefined,
          to_address: transaction.to || undefined,
          transaction_datetime: transaction.datetime
            ? new Date(transaction.datetime).toISOString()
            : new Date().toISOString(),
          transaction_status: (transaction.status as 'pending' | 'confirmed' | 'failed' | 'cancelled') || 'confirmed',
          transaction_type:
            (transaction.type as 'trade' | 'transfer' | 'deposit' | 'withdrawal' | 'fee' | 'reward' | 'mining') ||
            'trade',
          verified: Boolean(transaction.metadata?.verified),
        })
        .onConflict((oc) =>
          oc.doUpdateSet({
            amount: (eb) => eb.ref('excluded.amount'),
            amount_currency: (eb) => eb.ref('excluded.amount_currency'),
            fee_cost: (eb) => eb.ref('excluded.fee_cost'),
            fee_currency: (eb) => eb.ref('excluded.fee_currency'),
            from_address: (eb) => eb.ref('excluded.from_address'),
            note_message: (eb) => eb.ref('excluded.note_message'),
            note_metadata: (eb) => eb.ref('excluded.note_metadata'),
            note_severity: (eb) => eb.ref('excluded.note_severity'),
            note_type: (eb) => eb.ref('excluded.note_type'),
            price: (eb) => eb.ref('excluded.price'),
            price_currency: (eb) => eb.ref('excluded.price_currency'),
            raw_normalized_data: (eb) => eb.ref('excluded.raw_normalized_data'),
            symbol: (eb) => eb.ref('excluded.symbol'),
            to_address: (eb) => eb.ref('excluded.to_address'),
            transaction_datetime: (eb) => eb.ref('excluded.transaction_datetime'),
            transaction_status: (eb) => eb.ref('excluded.transaction_status'),
            transaction_type: (eb) => eb.ref('excluded.transaction_type'),
            updated_at: new Date().toISOString(),
            verified: (eb) => eb.ref('excluded.verified'),
          })
        )
        .returning('id')
        .executeTakeFirstOrThrow();

      this.logger.debug({ source: transaction.source, transactionId: result.id }, 'Transaction saved successfully');

      return result.id;
    } catch (error) {
      this.logger.error(
        { error, transaction: { source: transaction.source, type: transaction.type } },
        'Failed to save transaction'
      );
      throw error;
    }
  }

  async getTransactions(sourceId?: string, since?: number): Promise<StoredTransaction[]> {
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

      this.logger.debug({ since, sourceId }, `Retrieved ${transactions.length} transactions`);

      return transactions;
    } catch (error) {
      this.logger.error({ error, since, sourceId }, 'Failed to retrieve transactions');
      throw error;
    }
  }

  async findByAddress(address: string): Promise<StoredTransaction[]> {
    try {
      const transactions = await this.db
        .selectFrom('transactions')
        .selectAll()
        .where((eb) => eb.or([eb('from_address', '=', address), eb('to_address', '=', address)]))
        .orderBy('transaction_datetime', 'desc')
        .execute();

      this.logger.debug({ address }, `Retrieved ${transactions.length} transactions by address`);

      return transactions;
    } catch (error) {
      this.logger.error({ address, error }, 'Failed to retrieve transactions by address');
      throw error;
    }
  }

  async findRecent(address: string, limit: number): Promise<StoredTransaction[]> {
    try {
      const transactions = await this.db
        .selectFrom('transactions')
        .selectAll()
        .where((eb) => eb.or([eb('from_address', '=', address), eb('to_address', '=', address)]))
        .orderBy('transaction_datetime', 'desc')
        .limit(limit)
        .execute();

      this.logger.debug({ address, limit }, `Retrieved ${transactions.length} recent transactions`);

      return transactions;
    } catch (error) {
      this.logger.error({ address, error, limit }, 'Failed to retrieve recent transactions by address');
      throw error;
    }
  }

  async findByDateRange(address: string, from: Date, to: Date): Promise<StoredTransaction[]> {
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

      this.logger.debug({ address, from, to }, `Retrieved ${transactions.length} transactions in date range`);

      return transactions;
    } catch (error) {
      this.logger.error({ address, error, from, to }, 'Failed to retrieve transactions by date range');
      throw error;
    }
  }

  async getTransactionCount(sourceId?: string): Promise<number> {
    try {
      let query = this.db.selectFrom('transactions').select((eb) => eb.fn.count<number>('id').as('count'));

      if (sourceId) {
        query = query.where('source_id', '=', sourceId);
      }

      const result = await query.executeTakeFirstOrThrow();

      this.logger.debug({ sourceId }, `Transaction count retrieved: ${result.count}`);

      return result.count;
    } catch (error) {
      this.logger.error({ error, sourceId }, 'Failed to get transaction count');
      throw error;
    }
  }
}
