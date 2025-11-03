/**
 * Pure business logic for price normalization
 *
 * These functions implement the core normalization rules without side effects:
 * - Identify movements that need FX conversion (non-USD fiat → USD)
 * - Validate FX rates
 * - Create normalized price data structures
 *
 * Following "Functional Core, Imperative Shell" pattern from CLAUDE.md
 */

import type { AssetMovement, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { Currency } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * Result of movement classification
 */
export interface MovementsNeedingNormalization {
  /** Movements that need FX conversion (non-USD fiat prices) */
  needsNormalization: AssetMovement[];
  /** Movements to skip (already USD or crypto) */
  skipped: AssetMovement[];
  /** Crypto prices found in price field (unexpected) */
  cryptoPrices: AssetMovement[];
}

/**
 * Extract movements from a transaction that need FX normalization
 *
 * Classification rules:
 * - USD prices → skip (already normalized)
 * - EUR/CAD/GBP prices → normalize (non-USD fiat)
 * - Crypto prices → skip with warning (shouldn't exist in price field)
 *
 * @param tx - Transaction to analyze
 * @returns Classified movements
 */
export function extractMovementsNeedingNormalization(tx: UniversalTransaction): MovementsNeedingNormalization {
  const allMovements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? [])];

  const needsNormalization: AssetMovement[] = [];
  const skipped: AssetMovement[] = [];
  const cryptoPrices: AssetMovement[] = [];

  for (const movement of allMovements) {
    // No price - skip
    if (!movement.priceAtTxTime) {
      continue;
    }

    const priceCurrency = movement.priceAtTxTime.price.currency;

    // Already USD - skip
    if (priceCurrency.toString() === 'USD') {
      skipped.push(movement);
      continue;
    }

    // Non-USD fiat - needs normalization
    if (priceCurrency.isFiat()) {
      needsNormalization.push(movement);
      continue;
    }

    // Crypto currency in price field - skip (shouldn't happen, but graceful degradation)
    cryptoPrices.push(movement);
  }

  return {
    needsNormalization,
    skipped,
    cryptoPrices,
  };
}

/**
 * Validate FX rate is positive and within reasonable bounds
 *
 * @param rate - FX rate to validate
 * @returns Result indicating validity
 */
export function validateFxRate(rate: Decimal): Result<void, Error> {
  // Must be positive
  if (rate.lessThanOrEqualTo(0)) {
    return err(new Error(`Invalid FX rate: ${rate.toString()} (must be positive)`));
  }

  // Sanity check: FX rates should be reasonable
  // Lower bound set to 1e-7 to accommodate low-value currencies like VND (~0.00004)
  // while still catching truly erroneous data
  const MIN_REASONABLE_RATE = new Decimal('0.0000001');
  const MAX_REASONABLE_RATE = new Decimal('1000');

  if (rate.lessThan(MIN_REASONABLE_RATE)) {
    return err(new Error(`Suspicious FX rate: ${rate.toString()} (too low, possible data error)`));
  }

  if (rate.greaterThan(MAX_REASONABLE_RATE)) {
    return err(new Error(`Suspicious FX rate: ${rate.toString()} (too high, possible data error)`));
  }

  return ok();
}

/**
 * Create normalized price with FX conversion metadata
 *
 * Converts a price from non-USD fiat to USD and populates FX metadata fields
 * for audit trail.
 *
 * @param original - Original price data (e.g., EUR price)
 * @param fxRate - FX conversion rate (e.g., EUR→USD rate of 1.08)
 * @param fxSource - Source of FX rate (e.g., 'ecb', 'bank-of-canada')
 * @param fxTimestamp - Timestamp of FX rate
 * @returns Normalized price in USD with FX metadata
 */
export function createNormalizedPrice(
  original: PriceAtTxTime,
  fxRate: Decimal,
  fxSource: string,
  fxTimestamp: Date
): PriceAtTxTime {
  const originalAmount = original.price.amount;
  const usdAmount = originalAmount.times(fxRate);

  return {
    ...original,
    price: {
      amount: usdAmount,
      currency: Currency.create('USD'),
    },
    // FX metadata for audit trail
    fxRateToUSD: fxRate,
    fxSource,
    fxTimestamp,
  };
}

/**
 * Check if a movement needs FX normalization
 *
 * @param movement - Movement to check
 * @returns True if movement has non-USD fiat price
 */
export function movementNeedsNormalization(movement: AssetMovement): boolean {
  if (!movement.priceAtTxTime) {
    return false;
  }

  const priceCurrency = movement.priceAtTxTime.price.currency;

  // Skip if already USD
  if (priceCurrency.toString() === 'USD') {
    return false;
  }

  // Only normalize fiat currencies (EUR, CAD, GBP, etc.)
  return priceCurrency.isFiat();
}

/**
 * Classify a price currency for normalization
 *
 * @param movement - Movement with price data
 * @returns Classification: 'needs-normalization' | 'already-usd' | 'crypto' | 'no-price'
 */
export function classifyMovementPrice(
  movement: AssetMovement
): 'needs-normalization' | 'already-usd' | 'crypto' | 'no-price' {
  if (!movement.priceAtTxTime) {
    return 'no-price';
  }

  const priceCurrency = movement.priceAtTxTime.price.currency;

  if (priceCurrency.toString() === 'USD') {
    return 'already-usd';
  }

  if (priceCurrency.isFiat()) {
    return 'needs-normalization';
  }

  return 'crypto';
}
