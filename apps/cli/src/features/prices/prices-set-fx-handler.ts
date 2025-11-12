// Handler for prices set-fx command
// Uses ManualPriceService to save manual FX rate entries

import { parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { ManualPriceService } from '@exitbook/price-providers';
import { err, ok, type Result } from 'neverthrow';

const logger = getLogger('PricesSetFxHandler');

/**
 * Options for prices set-fx command
 */
export interface PricesSetFxOptions {
  /** Source currency (e.g., 'EUR', 'CAD') */
  from: string;

  /** Target currency (e.g., 'USD') */
  to: string;

  /** Date/time as ISO 8601 string */
  date: string;

  /** FX rate value as string */
  rate: string;

  /** Source attribution (default: 'user-provided') */
  source?: string | undefined;
}

/**
 * Result of prices set-fx command
 */
export interface PricesSetFxResult {
  from: string;
  to: string;
  timestamp: Date;
  rate: string;
  source: string;
}

/**
 * Handler for prices set-fx command
 */
export class PricesSetFxHandler {
  private service = new ManualPriceService();

  /**
   * Execute prices set-fx command
   */
  async execute(options: PricesSetFxOptions): Promise<Result<PricesSetFxResult, Error>> {
    try {
      // Validate and parse inputs
      const validationResult = this.validateInputs(options);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      const { from, to, timestamp, rateValue, source } = validationResult.value;

      // Save FX rate using service
      const saveResult = await this.service.saveFxRate({
        from,
        to,
        date: timestamp,
        rate: rateValue,
        source,
      });

      if (saveResult.isErr()) {
        return err(saveResult.error);
      }

      logger.info(
        `Saved manual FX rate: ${from}→${to} = ${rateValue.toFixed()} at ${timestamp.toISOString()} (source: ${source})`
      );

      return ok({
        from,
        to,
        timestamp,
        rate: rateValue.toFixed(),
        source,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new Error(`Failed to set FX rate: ${errorMessage}`));
    }
  }

  /**
   * Cleanup resources (no-op for service-based approach)
   */
  destroy(): void {
    // Service handles its own lifecycle
  }

  /**
   * Validate and parse command options
   */
  private validateInputs(options: PricesSetFxOptions): Result<
    {
      from: string;
      rateValue: import('decimal.js').Decimal;
      source: string;
      timestamp: Date;
      to: string;
    },
    Error
  > {
    try {
      // Validate source currency
      if (!options.from || typeof options.from !== 'string') {
        return err(new Error('Source currency is required'));
      }
      const from = options.from.toUpperCase();
      if (!/^[A-Z]{3,10}$/.test(from)) {
        return err(new Error('Source currency must be 3-10 uppercase letters (e.g., EUR, CAD)'));
      }

      // Validate target currency
      if (!options.to || typeof options.to !== 'string') {
        return err(new Error('Target currency is required'));
      }
      const to = options.to.toUpperCase();
      if (!/^[A-Z]{3,10}$/.test(to)) {
        return err(new Error('Target currency must be 3-10 uppercase letters (e.g., USD)'));
      }

      // Validate currencies are not the same
      if (from === to) {
        return err(new Error('Source and target currencies must be different'));
      }

      // Validate timestamp
      if (!options.date || typeof options.date !== 'string') {
        return err(new Error('Date is required (ISO 8601 format)'));
      }
      const timestamp = new Date(options.date);
      if (isNaN(timestamp.getTime())) {
        return err(new Error('Invalid date format. Use ISO 8601 (e.g., 2024-01-15T10:30:00Z)'));
      }

      // Validate rate
      if (!options.rate || typeof options.rate !== 'string') {
        return err(new Error('FX rate is required'));
      }
      let rateValue;
      try {
        rateValue = parseDecimal(options.rate);
        if (rateValue.lte(0)) {
          return err(new Error('FX rate must be greater than 0'));
        }
      } catch {
        return err(new Error('Invalid FX rate value. Must be a valid number.'));
      }

      // Validate source
      const source = options.source || 'user-provided';

      return ok({
        from,
        to,
        timestamp,
        rateValue,
        source,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(new Error(`Validation failed: ${errorMessage}`));
    }
  }
}
