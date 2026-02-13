/**
 * Price repository - manages cached price data
 */

import { Currency, parseDecimal } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import { roundToMinute, roundToHour, roundToDay } from '../../core/utils.js';
import type { PriceData } from '../../index.js';
import type { PricesDB } from '../database.js';

export interface PriceRecord {
  id: number;
  asset_symbol: string;
  currency: string;
  timestamp: string;
  price: string;
  source_provider: string;
  provider_coin_id: string | null;
  granularity: string | null | undefined;
  fetched_at: string;
  updated_at: string | null;
}

/**
 * Repository for managing cached price data
 */
export class PriceRepository {
  private readonly logger = getLogger('PriceRepository');

  constructor(private readonly db: PricesDB) {}

  /**
   * Get cached price for asset/currency/timestamp
   * Tries multiple granularity levels: minute, hour, day
   * Returns the most precise match available
   */
  async getPrice(
    assetSymbol: Currency,
    currency: Currency,
    timestamp: Date
  ): Promise<Result<PriceData | undefined, Error>> {
    try {
      // Try to find exact matches at different granularities (most precise first)
      const minuteBucket = roundToMinute(timestamp);
      const hourBucket = roundToHour(timestamp);
      const dayBucket = roundToDay(timestamp);

      // Query for any prices on the same day (covers all granularities)
      const startOfDay = new Date(dayBucket);
      const endOfDay = new Date(dayBucket);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const records = await this.db
        .selectFrom('prices')
        .selectAll()
        .where('asset_symbol', '=', assetSymbol.toString())
        .where('currency', '=', currency.toString())
        .where('timestamp', '>=', startOfDay.toISOString())
        .where('timestamp', '<=', endOfDay.toISOString())
        .execute();

      if (records.length === 0) {
        return ok(undefined);
      }

      // Prefer exact granularity matches
      // 1. Try minute bucket
      const minuteMatch = records.find((r) => r.timestamp === minuteBucket.toISOString());
      if (minuteMatch) {
        return ok(this.recordToPriceData(minuteMatch));
      }

      // 2. Try hour bucket
      const hourMatch = records.find((r) => r.timestamp === hourBucket.toISOString());
      if (hourMatch) {
        return ok(this.recordToPriceData(hourMatch));
      }

      // 3. Try day bucket
      const dayMatch = records.find((r) => r.timestamp === dayBucket.toISOString());
      if (dayMatch) {
        return ok(this.recordToPriceData(dayMatch));
      }

      // 4. No exact bucket match - find closest timestamp
      let closestRecord = records[0]!;
      let smallestDiff = Math.abs(new Date(closestRecord.timestamp).getTime() - timestamp.getTime());

      for (const record of records.slice(1)) {
        const diff = Math.abs(new Date(record.timestamp).getTime() - timestamp.getTime());
        if (diff < smallestDiff) {
          smallestDiff = diff;
          closestRecord = record;
        }
      }

      return ok(this.recordToPriceData(closestRecord));
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
          asset_symbol: priceData.assetSymbol.toString(),
          currency: priceData.currency.toString(),
          timestamp: timestampStr,
          price: priceData.price.toFixed(),
          source_provider: priceData.source,
          provider_coin_id: providerCoinId ?? undefined,
          granularity: priceData.granularity ?? undefined,
          fetched_at: priceData.fetchedAt.toISOString(),
        })
        .onConflict((oc) =>
          oc.columns(['asset_symbol', 'currency', 'timestamp']).doUpdateSet({
            price: priceData.price.toFixed(),
            source_provider: priceData.source,
            provider_coin_id: providerCoinId ?? undefined,
            granularity: priceData.granularity ?? undefined,
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
          const coinId = providerCoinIds?.get(priceData.assetSymbol.toString());
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
    assetSymbol: string,
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
        .where('asset_symbol', '=', assetSymbol.toUpperCase())
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
  async hasPrice(assetSymbol: string, currency: string, timestamp: Date): Promise<Result<boolean, Error>> {
    try {
      // Look for prices on the same day
      const startOfDay = new Date(timestamp);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(timestamp);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const count = await this.db
        .selectFrom('prices')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('asset_symbol', '=', assetSymbol.toUpperCase())
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
    const granularity = this.normalizeGranularity(record.granularity, record);

    return {
      assetSymbol: Currency.create(record.asset_symbol),
      currency: Currency.create(record.currency),
      timestamp: new Date(record.timestamp),
      price: parseDecimal(record.price),
      source: record.source_provider,
      fetchedAt: new Date(record.fetched_at),
      granularity,
    };
  }

  private normalizeGranularity(raw: string | null | undefined, record: PriceRecord): PriceData['granularity'] {
    if (raw === null || raw === undefined) {
      return undefined;
    }

    if (raw === 'exact' || raw === 'minute' || raw === 'hour' || raw === 'day') {
      return raw;
    }

    this.logger.warn(
      {
        granularity: raw,
        assetSymbol: record.asset_symbol,
        currency: record.currency,
        timestamp: record.timestamp,
        sourceProvider: record.source_provider,
      },
      'Invalid granularity found in cached price record'
    );
    throw new Error(`Invalid cached price granularity: ${raw}`);
  }
}
