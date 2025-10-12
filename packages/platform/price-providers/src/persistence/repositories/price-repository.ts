/**
 * Price repository - manages cached price data
 */

import { Currency } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { PriceData } from '../../shared/types/index.js';
import type { PricesDB } from '../database.js';

export interface PriceRecord {
  id: number;
  asset_symbol: string;
  currency: string;
  timestamp: string;
  price: string;
  source_provider: string;
  provider_coin_id: string | null;
  fetched_at: string;
  created_at: string;
  updated_at: string | null;
}

/**
 * Repository for managing cached price data
 */
export class PriceRepository {
  constructor(private readonly db: PricesDB) {}

  /**
   * Get cached price for asset/currency/timestamp
   * Looks for prices on the same day and returns the closest match
   */
  async getPrice(asset: Currency, currency: Currency, timestamp: Date): Promise<Result<PriceData | undefined, Error>> {
    try {
      // Look for prices on the same day
      const startOfDay = new Date(timestamp);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(timestamp);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const records = await this.db
        .selectFrom('prices')
        .selectAll()
        .where('asset_symbol', '=', asset.toString())
        .where('currency', '=', currency.toString())
        .where('timestamp', '>=', startOfDay.toISOString())
        .where('timestamp', '<=', endOfDay.toISOString())
        .execute();

      if (records.length === 0) {
        // eslint-disable-next-line unicorn/no-useless-undefined -- explicit undefined for clarity
        return ok(undefined);
      }

      // If only one price on same day, use it
      if (records.length === 1) {
        const priceData: PriceData = this.recordToPriceData(records[0]!);
        return ok(priceData);
      }

      // If multiple prices on same day, find the closest one to requested timestamp

      let closestRecord = records[0]!;
      let smallestDiff = Math.abs(new Date(closestRecord.timestamp).getTime() - timestamp.getTime());

      for (const record of records.slice(1)) {
        const diff = Math.abs(new Date(record.timestamp).getTime() - timestamp.getTime());
        if (diff < smallestDiff) {
          smallestDiff = diff;
          closestRecord = record;
        }
      }

      const priceData: PriceData = this.recordToPriceData(closestRecord);

      return ok(priceData);
    } catch (error) {
      return wrapError(error, `Failed to get price`);
    }
  }

  /**
   * Save price to cache (upsert)
   */
  async savePrice(priceData: PriceData, providerCoinId?: string): Promise<Result<void, Error>> {
    try {
      const timestampStr = priceData.timestamp.toISOString();

      await this.db
        .insertInto('prices')
        .values({
          asset_symbol: priceData.asset.toString(),
          currency: priceData.currency.toString(),
          timestamp: timestampStr,
          price: priceData.price.toString(),
          source_provider: priceData.source,
          provider_coin_id: providerCoinId ?? undefined,
          fetched_at: priceData.fetchedAt.toISOString(),
          created_at: this.getCurrentDateTimeForDB(),
        })
        .onConflict((oc) =>
          oc.columns(['asset_symbol', 'currency', 'timestamp']).doUpdateSet({
            price: priceData.price.toString(),
            source_provider: priceData.source,
            provider_coin_id: providerCoinId ?? undefined,
            fetched_at: priceData.fetchedAt.toISOString(),
            updated_at: this.getCurrentDateTimeForDB(),
          })
        )
        .execute();

      return ok();
    } catch (error) {
      return wrapError(error, `Failed to save price`);
    }
  }

  /**
   * Batch save prices
   */
  async savePrices(prices: PriceData[], providerCoinIds?: Map<string, string>): Promise<Result<void, Error>> {
    try {
      // Insert in batches to avoid too many SQL variables
      const batchSize = 100;
      for (let i = 0; i < prices.length; i += batchSize) {
        const batch = prices.slice(i, i + batchSize);

        for (const priceData of batch) {
          const coinId = providerCoinIds?.get(priceData.asset.toString());
          const result = await this.savePrice(priceData, coinId);

          if (result.isErr()) {
            return result;
          }
        }
      }

      return ok();
    } catch (error) {
      return wrapError(error, `Failed to save prices`);
    }
  }

  /**
   * Get price range for an asset
   */
  async getPriceRange(
    asset: string,
    currency: string,
    startDate: Date,
    endDate: Date
  ): Promise<Result<PriceData[], Error>> {
    try {
      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();

      const records = await this.db
        .selectFrom('prices')
        .selectAll()
        .where('asset_symbol', '=', asset.toUpperCase())
        .where('currency', '=', currency.toUpperCase())
        .where('timestamp', '>=', startStr)
        .where('timestamp', '<=', endStr)
        .orderBy('timestamp', 'asc')
        .execute();

      const prices: PriceData[] = records.map((record) => this.recordToPriceData(record));

      return ok(prices);
    } catch (error) {
      return wrapError(error, `Failed to get price range`);
    }
  }

  /**
   * Check if price exists in cache for the given day
   */
  async hasPrice(asset: string, currency: string, timestamp: Date): Promise<Result<boolean, Error>> {
    try {
      // Look for prices on the same day
      const startOfDay = new Date(timestamp);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(timestamp);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const count = await this.db
        .selectFrom('prices')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('asset_symbol', '=', asset.toUpperCase())
        .where('currency', '=', currency.toUpperCase())
        .where('timestamp', '>=', startOfDay.toISOString())
        .where('timestamp', '<=', endOfDay.toISOString())
        .executeTakeFirst();

      return ok(Number(count?.count ?? 0) > 0);
    } catch (error) {
      return wrapError(error, `Failed to check price existence`);
    }
  }

  private getCurrentDateTimeForDB(): string {
    return new Date().toISOString();
  }

  private recordToPriceData(record: PriceRecord): PriceData {
    return {
      asset: Currency.create(record.asset_symbol),
      currency: Currency.create(record.currency),
      timestamp: new Date(record.timestamp),
      price: parseFloat(record.price),
      source: record.source_provider,
      fetchedAt: new Date(record.fetched_at),
    };
  }
}
