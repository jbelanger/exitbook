// Handler for prices set command
// Uses ManualPriceService to save manual price entries

import { parseDecimal } from '@exitbook/core';
import type { OverrideStore } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { ManualPriceService } from '@exitbook/price-providers';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

const logger = getLogger('PricesSetHandler');

/**
 * Options for prices set command
 */
export interface PricesSetOptions {
  /** Asset symbol (e.g., 'BTC', 'ETH') */
  asset: string;

  /** Date/time as ISO 8601 string */
  date: string;

  /** Price value as string */
  price: string;

  /** Currency code (default: 'USD') */
  currency?: string | undefined;

  /** Source attribution (default: 'manual-cli') */
  source?: string | undefined;
}

/**
 * Result of prices set command
 */
export interface PricesSetResult {
  asset: string;
  timestamp: Date;
  price: string;
  currency: string;
  source: string;
}

/**
 * Handler for prices set command
 */
export class PricesSetHandler {
  private service: ManualPriceService;

  constructor(
    databasePath: string,
    private readonly overrideStore?: OverrideStore | undefined
  ) {
    this.service = new ManualPriceService(databasePath);
  }

  /**
   * Execute prices set command
   */
  async execute(options: PricesSetOptions): Promise<Result<PricesSetResult, Error>> {
    try {
      // Validate and parse inputs
      const validationResult = this.validateInputs(options);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      const { asset, timestamp, priceValue, currency, source } = validationResult.value;

      // Save price using service
      const saveResult = await this.service.savePrice({
        assetSymbol: asset,
        date: timestamp,
        price: priceValue,
        currency,
        source,
      });

      if (saveResult.isErr()) {
        return err(saveResult.error);
      }

      logger.info(
        `Saved manual price: ${asset} = ${priceValue.toFixed()} ${currency} at ${timestamp.toISOString()} (source: ${source})`
      );

      // Write override event for durability across reprocessing
      if (this.overrideStore) {
        const appendResult = await this.overrideStore.append({
          scope: 'price',
          payload: {
            type: 'price_override',
            asset,
            quote_asset: currency,
            price: priceValue.toFixed(),
            price_source: source,
            timestamp: timestamp.toISOString(),
          },
        });

        if (appendResult.isErr()) {
          logger.warn({ error: appendResult.error }, 'Failed to write price override event');
        }
      }

      return ok({
        asset,
        timestamp,
        price: priceValue.toFixed(),
        currency,
        source,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to set price: ${errorMessage}`));
    }
  }

  /**
   * Validate and parse command options
   */
  private validateInputs(options: PricesSetOptions): Result<
    {
      asset: string;
      currency: string;
      priceValue: Decimal;
      source: string;
      timestamp: Date;
    },
    Error
  > {
    try {
      // Validate asset
      if (!options.asset || typeof options.asset !== 'string') {
        return err(new Error('Asset symbol is required'));
      }
      const asset = options.asset.toUpperCase();

      // Validate timestamp
      if (!options.date || typeof options.date !== 'string') {
        return err(new Error('Date is required (ISO 8601 format)'));
      }
      const timestamp = new Date(options.date);
      if (Number.isNaN(timestamp.getTime())) {
        return err(new Error('Invalid date format. Use ISO 8601 (e.g., 2024-01-15T10:30:00Z)'));
      }

      // Validate price
      if (!options.price || typeof options.price !== 'string') {
        return err(new Error('Price is required'));
      }
      let priceValue;
      try {
        priceValue = parseDecimal(options.price);
        if (priceValue.lte(0)) {
          return err(new Error('Price must be greater than 0'));
        }
      } catch {
        return err(new Error('Invalid price value. Must be a valid number.'));
      }

      // Validate currency
      const currency = (options.currency ?? 'USD').toUpperCase();
      if (!/^[A-Z]{3,10}$/.test(currency)) {
        return err(new Error('Currency must be 3-10 uppercase letters (e.g., USD, EUR)'));
      }

      // Validate source
      const source = options.source ?? 'manual-cli';

      return ok({
        asset,
        timestamp,
        priceValue,
        currency,
        source,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new Error(`Validation failed: ${errorMessage}`));
    }
  }
}
