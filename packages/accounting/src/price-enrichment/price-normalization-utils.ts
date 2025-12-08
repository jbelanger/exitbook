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

import type { AssetMovement, FeeMovement, PriceAtTxTime, UniversalTransactionData } from '@exitbook/core';
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
export function extractMovementsNeedingNormalization(tx: UniversalTransactionData): MovementsNeedingNormalization {
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
 * If the original source was 'fiat-execution-tentative' (non-USD fiat trade),
 * upgrades it to 'derived-ratio' upon successful normalization.
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

  // Upgrade source from tentative to derived-ratio on successful normalization
  const upgradedSource = original.source === 'fiat-execution-tentative' ? 'derived-ratio' : original.source;

  return {
    ...original,
    price: {
      amount: usdAmount,
      currency: Currency.create('USD'),
    },
    source: upgradedSource,
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

/**
 * Result for normalizing a single item (movement or fee)
 */
export interface ItemNormalizationResult<T> {
  /** The normalized or original item */
  item: T;
  /** Whether normalization was performed */
  wasNormalized: boolean;
  /** Error message if normalization failed */
  error?: string;
}

/**
 * Result for normalizing an entire transaction
 */
export interface TransactionNormalizationResult {
  /** Normalized transaction (or undefined if no changes needed) */
  transaction: UniversalTransactionData | undefined;
  /** Number of movements normalized */
  movementsNormalized: number;
  /** Number of movements skipped */
  movementsSkipped: number;
  /** Movements with crypto prices (unexpected) */
  cryptoPriceMovements: AssetMovement[];
  /** Errors that occurred during normalization */
  errors: { item: string; message: string }[];
}

/**
 * Normalize a single price to USD using provided FX rate fetcher
 *
 * This is a pure business logic function that delegates FX fetching to a callback.
 * The service layer injects the actual FX provider implementation.
 *
 * @param priceAtTxTime - Price to normalize
 * @param timestamp - Transaction timestamp for FX rate lookup
 * @param fetchFxRate - Callback to fetch FX rate (injected by service)
 * @returns Normalized price in USD with FX metadata
 */
export async function normalizePriceToUSD(
  priceAtTxTime: PriceAtTxTime,
  timestamp: Date,
  fetchFxRate: (
    currency: Currency,
    date: Date
  ) => Promise<Result<{ fetchedAt: Date; rate: Decimal; source: string }, Error>>
): Promise<Result<PriceAtTxTime, Error>> {
  const sourceCurrency = priceAtTxTime.price.currency;

  // Fetch FX rate via injected callback
  const fxRateResult = await fetchFxRate(sourceCurrency, timestamp);

  if (fxRateResult.isErr()) {
    return err(fxRateResult.error);
  }

  const fxData = fxRateResult.value;
  const fxRate = fxData.rate;

  // Validate FX rate
  const validationResult = validateFxRate(fxRate);
  if (validationResult.isErr()) {
    return err(
      new Error(
        `Invalid FX rate for ${sourceCurrency.toString()} → USD: ${validationResult.error.message} (rate: ${fxRate.toString()}, source: ${fxData.source})`
      )
    );
  }

  // Create normalized price
  const normalizedPrice = createNormalizedPrice(priceAtTxTime, fxRate, fxData.source, fxData.fetchedAt);

  return ok(normalizedPrice);
}

/**
 * Normalize an array of asset movements
 *
 * Pure function that processes each movement and returns normalization results.
 * The service layer handles logging and statistics aggregation.
 *
 * @param movements - Movements to normalize
 * @param txDatetime - Transaction datetime (ISO string)
 * @param normalizePriceFn - Function to normalize a single price (injected by caller)
 * @returns Array of normalization results for each movement
 */
export async function normalizeMovementArray(
  movements: AssetMovement[],
  txDatetime: string,
  normalizePriceFn: (price: PriceAtTxTime, date: Date) => Promise<Result<PriceAtTxTime, Error>>
): Promise<ItemNormalizationResult<AssetMovement>[]> {
  const results: ItemNormalizationResult<AssetMovement>[] = [];

  for (const movement of movements) {
    // Check if normalization needed
    if (!movementNeedsNormalization(movement)) {
      results.push({
        item: movement,
        wasNormalized: false,
      });
      continue;
    }

    // Normalize the price
    const normalizedPrice = await normalizePriceFn(movement.priceAtTxTime!, new Date(txDatetime));

    if (normalizedPrice.isErr()) {
      const priceCurrency = movement.priceAtTxTime!.price.currency;
      results.push({
        item: movement,
        wasNormalized: false,
        error: `Asset ${movement.asset} (${priceCurrency.toString()} → USD): ${normalizedPrice.error.message}`,
      });
      continue;
    }

    // Success - return normalized movement
    results.push({
      item: {
        ...movement,
        priceAtTxTime: normalizedPrice.value,
      },
      wasNormalized: true,
    });
  }

  return results;
}

/**
 * Check if a fee needs FX normalization
 *
 * @param fee - Fee to check
 * @returns True if fee has non-USD fiat price
 */
export function feeNeedsNormalization(fee: FeeMovement): boolean {
  if (!fee.priceAtTxTime) {
    return false;
  }

  const priceCurrency = fee.priceAtTxTime.price.currency;

  // Skip if already USD
  if (priceCurrency.toString() === 'USD') {
    return false;
  }

  // Only normalize fiat currencies (EUR, CAD, GBP, etc.)
  return priceCurrency.isFiat();
}

/**
 * Normalize an array of fees
 *
 * Pure function that processes each fee and returns normalization results.
 * The service layer handles logging and statistics aggregation.
 *
 * @param fees - Fees to normalize
 * @param txDatetime - Transaction datetime (ISO string)
 * @param normalizePriceFn - Function to normalize a single price (injected by caller)
 * @returns Array of normalization results for each fee
 */
export async function normalizeFeeArray(
  fees: FeeMovement[],
  txDatetime: string,
  normalizePriceFn: (price: PriceAtTxTime, date: Date) => Promise<Result<PriceAtTxTime, Error>>
): Promise<ItemNormalizationResult<FeeMovement>[]> {
  const results: ItemNormalizationResult<FeeMovement>[] = [];

  for (const fee of fees) {
    // Check if normalization needed
    if (!feeNeedsNormalization(fee)) {
      results.push({
        item: fee,
        wasNormalized: false,
      });
      continue;
    }

    // Normalize the price
    const normalizedPrice = await normalizePriceFn(fee.priceAtTxTime!, new Date(txDatetime));

    if (normalizedPrice.isErr()) {
      const priceCurrency = fee.priceAtTxTime!.price.currency;
      results.push({
        item: fee,
        wasNormalized: false,
        error: `Fee ${fee.asset} (${priceCurrency.toString()} → USD): ${normalizedPrice.error.message}`,
      });
      continue;
    }

    // Success - return normalized fee
    results.push({
      item: {
        ...fee,
        priceAtTxTime: normalizedPrice.value,
      },
      wasNormalized: true,
    });
  }

  return results;
}

/**
 * Normalize all movements and fees in a transaction
 *
 * Pure orchestration function that coordinates normalization of all price data
 * in a transaction. Returns structured results that the service layer can use
 * for logging and statistics.
 *
 * @param tx - Transaction to normalize
 * @param normalizePriceFn - Function to normalize a single price (injected by caller)
 * @returns Normalization result with statistics
 */
export async function normalizeTransactionMovements(
  tx: UniversalTransactionData,
  normalizePriceFn: (price: PriceAtTxTime, date: Date) => Promise<Result<PriceAtTxTime, Error>>
): Promise<TransactionNormalizationResult> {
  const inflows = tx.movements.inflows ?? [];
  const outflows = tx.movements.outflows ?? [];
  const fees = tx.fees ?? [];

  // Classify movements to determine what needs normalization
  const classification = extractMovementsNeedingNormalization(tx);

  // Check if any fees need normalization
  const feesNeedingNormalization = fees.filter((fee) => feeNeedsNormalization(fee));

  // Early exit if nothing to normalize
  if (classification.needsNormalization.length === 0 && feesNeedingNormalization.length === 0) {
    return {
      transaction: undefined,
      movementsNormalized: 0,
      movementsSkipped: classification.skipped.length,
      cryptoPriceMovements: classification.cryptoPrices,
      errors: [],
    };
  }

  // Normalize movements and fees
  const inflowResults = await normalizeMovementArray(inflows, tx.datetime, normalizePriceFn);
  const outflowResults = await normalizeMovementArray(outflows, tx.datetime, normalizePriceFn);
  const feeResults = await normalizeFeeArray(fees, tx.datetime, normalizePriceFn);

  // Aggregate statistics
  const allResults = [...inflowResults, ...outflowResults, ...feeResults];
  const movementsNormalized = allResults.filter((r) => r.wasNormalized).length;
  const errors = allResults.filter((r) => r.error).map((r) => ({ item: 'movement/fee', message: r.error! }));

  // Build normalized transaction
  const normalizedTransaction: UniversalTransactionData = {
    ...tx,
    movements: {
      inflows: inflowResults.map((r) => r.item),
      outflows: outflowResults.map((r) => r.item),
    },
    fees: feeResults.map((r) => r.item),
  };

  return {
    transaction: normalizedTransaction,
    movementsNormalized,
    movementsSkipped: classification.skipped.length,
    cryptoPriceMovements: classification.cryptoPrices,
    errors,
  };
}
