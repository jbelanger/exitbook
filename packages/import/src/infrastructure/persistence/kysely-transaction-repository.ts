import type { UniversalTransaction } from '@crypto/core';
import type { StoredTransaction } from '@crypto/data';
import { KyselyBaseRepository } from '@crypto/data/src/repositories/kysely-base-repository.ts';
import type { KyselyDB } from '@crypto/data/src/storage/kysely-database.ts';
import type { Decimal } from 'decimal.js';

import type { ITransactionRepository } from '../../app/ports/transaction-repository.ts';

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
export class KyselyTransactionRepository extends KyselyBaseRepository implements ITransactionRepository {
  constructor(db: KyselyDB) {
    super(db, 'KyselyTransactionRepository');
  }

  async save(transaction: UniversalTransaction): Promise<number> {
    return this.saveTransaction(transaction);
  }

  async saveBatch(transactions: UniversalTransaction[]): Promise<number> {
    return this.saveTransactions(transactions);
  }

  async saveTransaction(transaction: UniversalTransaction): Promise<number> {
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
          datetime: transaction.datetime || undefined,
          fee_cost: typeof transaction.fee === 'object' ? moneyToDbString(transaction.fee) : undefined,
          fee_currency: typeof transaction.fee === 'object' ? transaction.fee.currency : undefined,
          from_address: transaction.from || undefined,
          hash: (transaction.metadata?.hash || transaction.source + '-' + (transaction.id || 'unknown')) as string,
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
          raw_data: rawDataJson,
          source_id: transaction.source,
          status: transaction.status || undefined,
          symbol: transaction.symbol || undefined,
          timestamp: transaction.timestamp || this.getCurrentTimestamp(),
          to_address: transaction.to || undefined,
          type: transaction.type || 'unknown',
          verified: transaction.metadata?.verified ? 1 : 0,
        })
        .onConflict((oc) =>
          oc.doUpdateSet({
            amount: (eb) => eb.ref('excluded.amount'),
            amount_currency: (eb) => eb.ref('excluded.amount_currency'),
            datetime: (eb) => eb.ref('excluded.datetime'),
            fee_cost: (eb) => eb.ref('excluded.fee_cost'),
            fee_currency: (eb) => eb.ref('excluded.fee_currency'),
            from_address: (eb) => eb.ref('excluded.from_address'),
            note_message: (eb) => eb.ref('excluded.note_message'),
            note_metadata: (eb) => eb.ref('excluded.note_metadata'),
            note_severity: (eb) => eb.ref('excluded.note_severity'),
            note_type: (eb) => eb.ref('excluded.note_type'),
            price: (eb) => eb.ref('excluded.price'),
            price_currency: (eb) => eb.ref('excluded.price_currency'),
            raw_data: (eb) => eb.ref('excluded.raw_data'),
            status: (eb) => eb.ref('excluded.status'),
            symbol: (eb) => eb.ref('excluded.symbol'),
            timestamp: (eb) => eb.ref('excluded.timestamp'),
            to_address: (eb) => eb.ref('excluded.to_address'),
            type: (eb) => eb.ref('excluded.type'),
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

  async saveTransactions(transactions: UniversalTransaction[]): Promise<number> {
    if (transactions.length === 0) {
      this.logger.debug('No transactions to save');
      return 0;
    }

    return this.withTransaction(async (trx) => {
      let saved = 0;

      for (const transaction of transactions) {
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

          // wallet_id will be updated later by the linkTransactionAddresses method
          const walletId = undefined;

          const result = await trx
            .insertInto('transactions')
            .values({
              amount:
                typeof transaction.amount === 'object'
                  ? moneyToDbString(transaction.amount)
                  : transaction.amount
                    ? String(transaction.amount)
                    : undefined,
              amount_currency: amountCurrency,
              datetime: transaction.datetime || undefined,
              fee_cost: typeof transaction.fee === 'object' ? moneyToDbString(transaction.fee) : undefined,
              fee_currency: typeof transaction.fee === 'object' ? transaction.fee.currency : undefined,
              from_address: transaction.from || undefined,
              hash: (transaction.metadata?.hash || transaction.source + '-' + (transaction.id || 'unknown')) as string,
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
              raw_data: rawDataJson,
              source_id: transaction.source,
              status: transaction.status || undefined,
              symbol: transaction.symbol || undefined,
              timestamp: transaction.timestamp || this.getCurrentTimestamp(),
              to_address: transaction.to || undefined,
              type: transaction.type || 'unknown',
              verified: transaction.metadata?.verified ? 1 : 0,
              wallet_id: walletId,
            })
            .onConflict((oc) => oc.doNothing()) // Equivalent to INSERT OR IGNORE
            .execute();

          if (result.length > 0) {
            saved++;
          }
        } catch (error) {
          // Log error but continue with other transactions
          this.logger.warn(
            { error, transaction: { source: transaction.source, type: transaction.type } },
            'Failed to save individual transaction in batch'
          );
        }
      }

      this.logger.debug(`Batch transaction save completed: ${saved}/${transactions.length} transactions saved`);
      return saved;
    });
  }

  async getTransactions(sourceId?: string, since?: number): Promise<StoredTransaction[]> {
    try {
      let query = this.db.selectFrom('transactions').selectAll();

      // Add WHERE conditions if provided
      if (sourceId) {
        query = query.where('source_id', '=', sourceId);
      }

      if (since) {
        query = query.where('timestamp', '>=', since);
      }

      // Order by timestamp descending
      query = query.orderBy('timestamp', 'desc');

      const rows = await query.execute();

      // Convert database rows to StoredTransaction format
      const storedTransactions: StoredTransaction[] = rows.map((row) => ({
        amount: row.amount || '',
        amount_currency: row.amount_currency,
        // Add missing fields for compatibility
        cost: row.price,
        cost_currency: row.price_currency,
        created_at: typeof row.created_at === 'number' ? row.created_at : Date.now() / 1000,
        datetime: row.datetime,
        fee_cost: row.fee_cost,
        fee_currency: row.fee_currency,
        from_address: row.from_address,
        hash: row.hash || '',
        id: row.id,
        note_message: row.note_message,
        note_metadata: row.note_metadata,
        note_severity: row.note_severity,
        note_type: row.note_type,
        price: row.price,
        price_currency: row.price_currency,
        raw_data: row.raw_data,
        source_id: row.source_id,
        status: row.status,
        symbol: row.symbol,
        timestamp: row.timestamp,
        to_address: row.to_address,
        type: row.type,
        verified: Boolean(row.verified),
        wallet_id: row.wallet_id,
      }));

      this.logger.debug({ since, sourceId }, `Retrieved ${storedTransactions.length} transactions`);

      return storedTransactions;
    } catch (error) {
      this.logger.error({ error, since, sourceId }, 'Failed to retrieve transactions');
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
