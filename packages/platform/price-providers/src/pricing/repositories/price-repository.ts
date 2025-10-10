/**
 * Price repository - manages cached price data
 *
 * Imperative shell managing database operations
 */

import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { roundToDay } from '../../shared/price-utils.js';
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
   */
  async getPrice(asset: string, currency: string, timestamp: Date): Promise<Result<PriceData | undefined, Error>> {
    try {
      const roundedDate = roundToDay(timestamp);
      const timestampStr = roundedDate.toISOString();

      const record = await this.db
        .selectFrom('prices')
        .selectAll()
        .where('asset_symbol', '=', asset.toUpperCase())
        .where('currency', '=', currency.toUpperCase())
        .where('timestamp', '=', timestampStr)
        .executeTakeFirst();

      if (!record) {
        // eslint-disable-next-line unicorn/no-useless-undefined -- explicit undefined for clarity
        return ok(undefined);
      }

      const priceData: PriceData = {
        asset: record.asset_symbol,
        currency: record.currency,
        timestamp: new Date(record.timestamp),
        price: parseFloat(record.price),
        source: record.source_provider,
        fetchedAt: new Date(record.fetched_at),
      };

      return ok(priceData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to get price: ${message}`));
    }
  }

  /**
   * Save price to cache (upsert)
   */
  async savePrice(priceData: PriceData, providerCoinId?: string): Promise<Result<void, Error>> {
    try {
      const roundedDate = roundToDay(priceData.timestamp);
      const timestampStr = roundedDate.toISOString();

      await this.db
        .insertInto('prices')
        .values({
          asset_symbol: priceData.asset.toUpperCase(),
          currency: priceData.currency.toUpperCase(),
          timestamp: timestampStr,
          price: priceData.price.toString(),
          source_provider: priceData.source,
          provider_coin_id: providerCoinId ?? undefined,
          fetched_at: priceData.fetchedAt.toISOString(),
        })
        .onConflict((oc) =>
          oc.columns(['asset_symbol', 'currency', 'timestamp']).doUpdateSet({
            price: priceData.price.toString(),
            source_provider: priceData.source,
            provider_coin_id: providerCoinId ?? undefined,
            fetched_at: priceData.fetchedAt.toISOString(),
            updated_at: new Date().toISOString(),
          })
        )
        .execute();

      return ok();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to save price: ${message}`));
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
          const coinId = providerCoinIds?.get(priceData.asset.toUpperCase());
          const result = await this.savePrice(priceData, coinId);

          if (result.isErr()) {
            return result;
          }
        }
      }

      return ok();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to save prices: ${message}`));
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
      const startStr = roundToDay(startDate).toISOString();
      const endStr = roundToDay(endDate).toISOString();

      const records = await this.db
        .selectFrom('prices')
        .selectAll()
        .where('asset_symbol', '=', asset.toUpperCase())
        .where('currency', '=', currency.toUpperCase())
        .where('timestamp', '>=', startStr)
        .where('timestamp', '<=', endStr)
        .orderBy('timestamp', 'asc')
        .execute();

      const prices: PriceData[] = records.map((record) => ({
        asset: record.asset_symbol,
        currency: record.currency,
        timestamp: new Date(record.timestamp),
        price: parseFloat(record.price),
        source: record.source_provider,
        fetchedAt: new Date(record.fetched_at),
      }));

      return ok(prices);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to get price range: ${message}`));
    }
  }

  /**
   * Check if price exists in cache
   */
  async hasPrice(asset: string, currency: string, timestamp: Date): Promise<Result<boolean, Error>> {
    try {
      const roundedDate = roundToDay(timestamp);
      const timestampStr = roundedDate.toISOString();

      const count = await this.db
        .selectFrom('prices')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('asset_symbol', '=', asset.toUpperCase())
        .where('currency', '=', currency.toUpperCase())
        .where('timestamp', '=', timestampStr)
        .executeTakeFirst();

      return ok(Number(count?.count ?? 0) > 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to check price existence: ${message}`));
    }
  }
}
