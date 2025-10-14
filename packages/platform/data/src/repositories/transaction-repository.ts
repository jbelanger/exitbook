/* eslint-disable unicorn/no-null -- Kysely queries require null for IS NULL checks */
import type { Currency, AssetMovement, UniversalTransaction } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { StoredTransaction as _StoredTransaction } from '@exitbook/data';
import type { KyselyDB } from '@exitbook/data';
import { BaseRepository } from '@exitbook/data';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { ITransactionRepository } from './transaction-repository.interface.ts';

/**
 * Transaction record needing price data for its movements
 */
export interface TransactionNeedingPrice {
  id: number;
  transactionDatetime: string;
  movementsInflows: AssetMovement[];
  movementsOutflows: AssetMovement[];
}

// Local utility function to convert Money type to database string
function moneyToDbString(money: { amount: Decimal | number; currency: Currency }): string {
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
      let priceCurrency: Currency | undefined;

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
          price_currency: priceCurrency?.toString(),
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
          movements_primary_currency: transaction.movements?.primary.amount?.currency.toString(),
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
          oc.columns(['source_id', 'external_id']).doUpdateSet({
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
      return wrapError(error, 'Failed to save transaction');
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
      return wrapError(error, 'Failed to retrieve transactions');
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
      return wrapError(error, 'Failed to retrieve transactions by address');
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
      return wrapError(error, 'Failed to retrieve recent transactions by address');
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
      return wrapError(error, 'Failed to retrieve transactions by date range');
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
      return wrapError(error, 'Failed to get transaction count');
    }
  }

  /**
   * Find transactions with movements that need price data
   * Optionally filter by specific asset(s)
   */
  async findTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<TransactionNeedingPrice[], Error>> {
    try {
      const query = this.db
        .selectFrom('transactions')
        .select(['id', 'transaction_datetime', 'movements_inflows', 'movements_outflows'])
        .where((eb) => eb.or([eb('movements_inflows', 'is not', null), eb('movements_outflows', 'is not', null)]));

      const results = await query.execute();

      // Filter transactions that have movements without priceAtTxTime
      const transactionsNeedingPrices = results.filter((tx) => {
        const inflows = tx.movements_inflows ? (JSON.parse(tx.movements_inflows as string) as unknown[]) : [];
        const outflows = tx.movements_outflows ? (JSON.parse(tx.movements_outflows as string) as unknown[]) : [];

        const allMovements = [...inflows, ...outflows];

        // Check if any movement is missing priceAtTxTime
        const hasMovementsNeedingPrice = allMovements.some((movement: unknown) => {
          const m = movement as { asset: string; priceAtTxTime?: unknown };

          // If asset filter is provided, only check movements matching the filter
          if (assetFilter && assetFilter.length > 0) {
            if (!assetFilter.includes(m.asset)) {
              return false;
            }
          }

          return !m.priceAtTxTime;
        });

        return hasMovementsNeedingPrice;
      });

      return ok(
        transactionsNeedingPrices.map((tx) => ({
          id: tx.id,
          movementsInflows: tx.movements_inflows ? (JSON.parse(tx.movements_inflows as string) as AssetMovement[]) : [],
          movementsOutflows: tx.movements_outflows
            ? (JSON.parse(tx.movements_outflows as string) as AssetMovement[])
            : [],
          transactionDatetime: tx.transaction_datetime,
        }))
      );
    } catch (error) {
      return wrapError(error, 'Failed to find transactions needing prices');
    }
  }

  /**
   * Update a transaction's movements with price data
   * Enriches the movements JSON with priceAtTxTime for specified assets
   */
  async updateMovementsWithPrices(
    transactionId: number,
    priceData: {
      asset: string;
      fetchedAt: Date;
      granularity?: 'exact' | 'minute' | 'hour' | 'day' | undefined;
      price: { amount: Decimal; currency: Currency };
      source: string;
    }[]
  ) {
    try {
      // Fetch current transaction
      const tx = await this.db
        .selectFrom('transactions')
        .select(['movements_inflows', 'movements_outflows'])
        .where('id', '=', transactionId)
        .executeTakeFirst();

      if (!tx) {
        throw new Error(`Transaction ${transactionId} not found`);
      }

      // Parse movements
      const inflows = tx.movements_inflows ? (JSON.parse(tx.movements_inflows as string) as unknown[]) : [];
      const outflows = tx.movements_outflows ? (JSON.parse(tx.movements_outflows as string) as unknown[]) : [];

      // Create price lookup map
      const priceMap = new Map(
        priceData.map((p) => [
          p.asset,
          {
            fetchedAt: p.fetchedAt,
            granularity: p.granularity,
            price: {
              amount: p.price.amount,
              currency: p.price.currency,
            },
            source: p.source,
          },
        ])
      );

      // Enrich movements with price data
      const enrichMovement = (movement: unknown) => {
        const m = movement as { asset: string; priceAtTxTime?: unknown };
        const price = priceMap.get(m.asset);
        if (price && !m.priceAtTxTime) {
          return { ...m, priceAtTxTime: price };
        }
        return m;
      };

      const enrichedInflows = inflows.map(enrichMovement);
      const enrichedOutflows = outflows.map(enrichMovement);

      // Update transaction with enriched movements
      await this.db
        .updateTable('transactions')
        .set({
          movements_inflows: enrichedInflows.length > 0 ? this.serializeToJson(enrichedInflows) : null,
          movements_outflows: enrichedOutflows.length > 0 ? this.serializeToJson(enrichedOutflows) : null,
          updated_at: this.getCurrentDateTimeForDB(),
        })
        .where('id', '=', transactionId)
        .execute();

      // eslint-disable-next-line unicorn/no-useless-undefined -- Explicitly return undefined for clarity
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to update movements with prices');
    }
  }

  async deleteBySource(sourceId: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('transactions').where('source_id', '=', sourceId).executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete transactions by source');
    }
  }

  async deleteAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('transactions').executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete all transactions');
    }
  }
}
