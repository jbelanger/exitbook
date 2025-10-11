/* eslint-disable unicorn/no-null -- db requires null */
// Transaction repository for managing transaction records

import type { Currency } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { KyselyDB } from '../storage/database.js';

import { BaseRepository } from './base-repository.js';

/**
 * Transaction record needing price data
 */
export interface TransactionNeedingPrice {
  id: number;
  transactionDatetime: string;
  movementsPrimaryAsset: string;
  movementsPrimaryCurrency: string;
}

/**
 * Price data to update on a transaction
 */
export interface TransactionPriceUpdate {
  priceAtTxTime: string;
  priceAtTxTimeCurrency: Currency;
  priceAtTxTimeSource: string;
  priceAtTxTimeFetchedAt: string;
}

/**
 * Repository for transaction operations
 */
export class TransactionRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'TransactionRepository');
  }

  /**
   * Query transactions that are missing price_at_tx_time data
   * Optionally filter by specific assets
   */
  async findTransactionsNeedingPrices(assetFilter?: Currency[]): Promise<Result<TransactionNeedingPrice[], Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .select([
          'id',
          'transaction_datetime as transactionDatetime',
          'movements_primary_asset as movementsPrimaryAsset',
          'movements_primary_currency as movementsPrimaryCurrency',
        ])
        .where('price_at_tx_time', 'is', null)
        .where('movements_primary_asset', 'is not', null)
        .where('movements_primary_currency', 'is not', null);

      // Apply asset filter if provided
      if (assetFilter && assetFilter.length > 0) {
        query = query.where(
          'movements_primary_asset',
          'in',
          assetFilter.map((c) => c.toString())
        );
      }

      const results = await query.execute();

      return ok(
        results.map((r) => ({
          id: r.id,
          transactionDatetime: r.transactionDatetime,
          movementsPrimaryAsset: r.movementsPrimaryAsset as string,
          movementsPrimaryCurrency: r.movementsPrimaryCurrency as string,
        }))
      );
    } catch (error) {
      this.logger.error({ error }, 'Failed to query transactions needing prices');
      return err(error instanceof Error ? error : new Error(`Failed to query transactions: ${String(error)}`));
    }
  }

  /**
   * Update a transaction with price data
   */
  async updateTransactionPrice(transactionId: number, priceData: TransactionPriceUpdate): Promise<Result<void, Error>> {
    try {
      await this.db
        .updateTable('transactions')
        .set({
          price_at_tx_time: priceData.priceAtTxTime,
          price_at_tx_time_currency: priceData.priceAtTxTimeCurrency.toString(),
          price_at_tx_time_source: priceData.priceAtTxTimeSource,
          price_at_tx_time_fetched_at: priceData.priceAtTxTimeFetchedAt,
          updated_at: this.getCurrentDateTimeForDB(),
        })
        .where('id', '=', transactionId)
        .execute();

      return ok();
    } catch (error) {
      this.logger.error({ error, transactionId }, 'Failed to update transaction price');
      return err(error instanceof Error ? error : new Error(`Failed to update transaction: ${String(error)}`));
    }
  }

  /**
   * Batch update transaction prices
   * More efficient than updating one by one
   */
  async batchUpdateTransactionPrices(
    updates: { priceData: TransactionPriceUpdate; transactionId: number }[]
  ): Promise<Result<{ failed: number; successful: number }, Error>> {
    let successful = 0;
    let failed = 0;

    return this.withTransaction(async (trx) => {
      for (const { transactionId, priceData } of updates) {
        try {
          await trx
            .updateTable('transactions')
            .set({
              price_at_tx_time: priceData.priceAtTxTime,
              price_at_tx_time_currency: priceData.priceAtTxTimeCurrency.toString(),
              price_at_tx_time_source: priceData.priceAtTxTimeSource,
              price_at_tx_time_fetched_at: priceData.priceAtTxTimeFetchedAt,
              updated_at: this.getCurrentDateTimeForDB(),
            })
            .where('id', '=', transactionId)
            .execute();

          successful++;
        } catch (error) {
          this.logger.warn({ error, transactionId }, 'Failed to update transaction in batch');
          failed++;
        }
      }

      return ok({ successful, failed });
    });
  }

  /**
   * Count transactions missing price data
   * Useful for reporting before/after price fetch operations
   */
  async countTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<number, Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .select(({ fn }) => [fn.countAll<number>().as('count')])
        .where('price_at_tx_time', 'is', null)
        .where('movements_primary_asset', 'is not', null)
        .where('movements_primary_currency', 'is not', null);

      if (assetFilter && assetFilter.length > 0) {
        query = query.where('movements_primary_asset', 'in', assetFilter);
      }

      const result = await query.executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      this.logger.error({ error }, 'Failed to count transactions needing prices');
      return err(error instanceof Error ? error : new Error(`Failed to count transactions: ${String(error)}`));
    }
  }
}
