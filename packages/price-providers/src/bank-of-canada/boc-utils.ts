/**
 * Utility functions for Bank of Canada provider
 *
 * Pure functions for transforming Bank of Canada API responses
 */

import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PriceData } from '../shared/types/index.js';

import type { BankOfCanadaResponse } from './schemas.js';

/**
 * Format date for Bank of Canada API (YYYY-MM-DD)
 */
export function formatBoCDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Transform Bank of Canada API response to PriceData
 *
 * Pure function - all inputs explicitly passed
 */
export function transformBoCResponse(
  response: BankOfCanadaResponse,
  asset: Currency,
  timestamp: Date,
  currency: Currency,
  fetchedAt: Date
): Result<PriceData, Error> {
  const observations = response.observations;
  if (!observations || observations.length === 0) {
    return err(new Error(`No exchange rate data found for ${String(asset)} on ${formatBoCDate(timestamp)}`));
  }

  // Bank of Canada returns observations in date order
  // For a specific date query, should return one observation
  const observation = observations[0];
  if (!observation) {
    return err(new Error('Empty observation in Bank of Canada response'));
  }

  // Extract rate value (preserve precision by using Decimal from string)
  const rateStr = observation.FXUSDCAD.v;
  const usdCadRate = parseDecimal(rateStr);

  if (usdCadRate.lessThanOrEqualTo(0)) {
    return err(new Error(`Invalid exchange rate: ${rateStr}`));
  }

  // Bank of Canada provides USD/CAD rate
  // We need CAD/USD (reciprocal) for consistency with other providers
  const cadToUsdRate = new Decimal(1).dividedBy(usdCadRate);

  return ok({
    asset,
    timestamp,
    price: cadToUsdRate,
    currency,
    source: 'bank-of-canada',
    fetchedAt,
    granularity: 'day',
  });
}
