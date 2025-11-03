/**
 * Service for normalizing non-USD fiat prices to USD using FX providers
 *
 * This is Stage 1 of the enrichment pipeline:
 * - Finds movements with non-USD fiat prices (EUR, CAD, GBP, etc.)
 * - Fetches historical FX rates via PriceProviderManager
 * - Converts prices to USD
 * - Populates FX metadata (fxRateToUSD, fxSource, fxTimestamp)
 *
 * Example:
 * Before: priceAtTxTime = { price: { amount: 40000, currency: EUR }, ... }
 * After:  priceAtTxTime = {
 *           price: { amount: 43200, currency: USD },
 *           fxRateToUSD: 1.08,
 *           fxSource: 'ecb',
 *           fxTimestamp: '2023-01-15T10:00:00Z',
 *           ...
 *         }
 */

import type { AssetMovement, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { Currency, wrapError } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import type { PriceProviderManager } from '@exitbook/platform-price-providers';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

const logger = getLogger('PriceNormalizationService');

/**
 * Result of normalization operation
 */
export interface NormalizeResult {
  /** Number of movements normalized from non-USD fiat to USD */
  movementsNormalized: number;

  /** Number of movements skipped (already USD or crypto) */
  movementsSkipped: number;

  /** Number of movements that failed to normalize */
  failures: number;

  /** Error messages for failures */
  errors: string[];
}

/**
 * Service for normalizing non-USD fiat prices to USD
 */
export class PriceNormalizationService {
  constructor(
    private readonly transactionRepository: TransactionRepository,
    private readonly priceManager: PriceProviderManager
  ) {}

  /**
   * Normalize all non-USD fiat prices to USD
   *
   * Process:
   * 1. Find all transactions with movements that have prices
   * 2. For each movement with non-USD fiat price:
   *    a. Fetch FX rate via PriceProviderManager (EUR→USD at tx time)
   *    b. Convert price.amount to USD
   *    c. Populate fxRateToUSD, fxSource, fxTimestamp metadata
   *    d. Update price.currency to 'USD'
   * 3. Skip crypto prices (they shouldn't exist yet, but log warning)
   * 4. Skip already-USD prices
   *
   * @param options - Optional configuration
   * @returns Result with normalization statistics
   */
  async normalize(options?: { interactive?: boolean }): Promise<Result<NormalizeResult, Error>> {
    try {
      logger.info('Starting price normalization (non-USD fiat → USD)');

      // Get all transactions (we need to check all for non-USD fiat prices)
      const txResult = await this.transactionRepository.getTransactions();
      if (txResult.isErr()) {
        return err(txResult.error);
      }

      const transactions = txResult.value;
      logger.info({ transactionCount: transactions.length }, 'Loaded transactions for normalization');

      const result: NormalizeResult = {
        movementsNormalized: 0,
        movementsSkipped: 0,
        failures: 0,
        errors: [],
      };

      // Track which transactions need updates
      const transactionsToUpdate = new Map<number, UniversalTransaction>();

      // Process each transaction
      for (const tx of transactions) {
        const normalizedTx = await this.normalizeTransaction(tx, result, options);
        if (normalizedTx) {
          transactionsToUpdate.set(tx.id, normalizedTx);
        }
      }

      // Update database with normalized transactions
      logger.info({ transactionsToUpdate: transactionsToUpdate.size }, 'Updating transactions with normalized prices');

      for (const tx of transactionsToUpdate.values()) {
        const updateResult = await this.updateTransactionPrices(tx);
        if (updateResult.isErr()) {
          logger.error({ txId: tx.id, error: updateResult.error }, 'Failed to update transaction');
          result.failures++;
          result.errors.push(`Transaction ${tx.id}: ${updateResult.error.message}`);
        }
      }

      logger.info(
        {
          normalized: result.movementsNormalized,
          skipped: result.movementsSkipped,
          failures: result.failures,
        },
        'Price normalization completed'
      );

      return ok(result);
    } catch (error) {
      return wrapError(error, 'Failed to normalize prices');
    }
  }

  /**
   * Normalize a single transaction
   * Returns the normalized transaction if any changes were made, undefined otherwise
   */
  private async normalizeTransaction(
    tx: UniversalTransaction,
    result: NormalizeResult,
    options?: { interactive?: boolean }
  ): Promise<UniversalTransaction | undefined> {
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];
    const allMovements = [...inflows, ...outflows];

    // Find movements needing normalization
    const movementsNeedingNormalization: AssetMovement[] = [];

    for (const movement of allMovements) {
      if (!movement.priceAtTxTime) {
        continue; // No price to normalize
      }

      const priceCurrency = movement.priceAtTxTime.price.currency;

      // Skip if already USD
      if (priceCurrency.toString() === 'USD') {
        result.movementsSkipped++;
        continue;
      }

      // Check if this is a non-USD fiat currency
      if (!priceCurrency.isFiat()) {
        // Crypto currency in price field - this shouldn't happen, log warning
        logger.warn(
          {
            txId: tx.id,
            asset: movement.asset,
            priceCurrency: priceCurrency.toString(),
          },
          'Found crypto currency in price field (unexpected - prices should be in fiat)'
        );
        result.movementsSkipped++;
        continue;
      }

      // This is a non-USD fiat price that needs normalization
      movementsNeedingNormalization.push(movement);
    }

    // If no movements need normalization, skip this transaction
    if (movementsNeedingNormalization.length === 0) {
      return undefined;
    }

    logger.debug(
      {
        txId: tx.id,
        movementsToNormalize: movementsNeedingNormalization.length,
      },
      'Normalizing transaction'
    );

    // Normalize each movement
    const normalizedInflows = await this.normalizeMovements(inflows, tx.datetime, result, options);
    const normalizedOutflows = await this.normalizeMovements(outflows, tx.datetime, result, options);

    // Return updated transaction
    return {
      ...tx,
      movements: {
        inflows: normalizedInflows,
        outflows: normalizedOutflows,
      },
    };
  }

  /**
   * Normalize an array of movements
   */
  private async normalizeMovements(
    movements: AssetMovement[],
    txDatetime: string,
    result: NormalizeResult,
    options?: { interactive?: boolean }
  ): Promise<AssetMovement[]> {
    const normalized: AssetMovement[] = [];

    for (const movement of movements) {
      if (!movement.priceAtTxTime) {
        normalized.push(movement);
        continue;
      }

      const priceCurrency = movement.priceAtTxTime.price.currency;

      // Skip if already USD or not fiat
      if (priceCurrency.toString() === 'USD' || !priceCurrency.isFiat()) {
        normalized.push(movement);
        continue;
      }

      // Normalize this price
      const normalizedPrice = await this.normalizePriceToUSD(movement.priceAtTxTime, new Date(txDatetime), options);

      if (normalizedPrice.isErr()) {
        logger.warn(
          {
            asset: movement.asset,
            currency: priceCurrency.toString(),
            error: normalizedPrice.error.message,
          },
          'Failed to normalize price'
        );
        result.failures++;
        result.errors.push(
          `Asset ${movement.asset} (${priceCurrency.toString()} → USD): ${normalizedPrice.error.message}`
        );
        // Keep original price
        normalized.push(movement);
        continue;
      }

      // Success - update movement with normalized price
      result.movementsNormalized++;
      normalized.push({
        ...movement,
        priceAtTxTime: normalizedPrice.value,
      });
    }

    return normalized;
  }

  /**
   * Normalize a single price from non-USD fiat to USD
   */
  private async normalizePriceToUSD(
    priceAtTxTime: PriceAtTxTime,
    timestamp: Date,
    _options?: { interactive?: boolean }
  ): Promise<Result<PriceAtTxTime, Error>> {
    const sourceCurrency = priceAtTxTime.price.currency;
    const sourceAmount = priceAtTxTime.price.amount;

    // Fetch FX rate from provider manager
    // The manager will try providers in order: ECB → Bank of Canada → Frankfurter
    const fxRateResult = await this.priceManager.fetchPrice({
      asset: sourceCurrency,
      currency: Currency.create('USD'),
      timestamp,
    });

    if (fxRateResult.isErr()) {
      return err(
        new Error(`Failed to fetch FX rate for ${sourceCurrency.toString()} → USD: ${fxRateResult.error.message}`)
      );
    }

    const fxData = fxRateResult.value.data;
    const fxRate = fxData.price;

    // Convert price to USD
    const usdAmount = sourceAmount.times(fxRate);

    // Create normalized price with FX metadata
    const normalizedPrice: PriceAtTxTime = {
      ...priceAtTxTime,
      price: {
        amount: usdAmount,
        currency: Currency.create('USD'),
      },
      // Populate FX metadata
      fxRateToUSD: fxRate,
      fxSource: fxData.source,
      fxTimestamp: fxData.fetchedAt,
    };

    logger.debug(
      {
        originalCurrency: sourceCurrency.toString(),
        originalAmount: sourceAmount.toString(),
        fxRate: fxRate.toString(),
        usdAmount: usdAmount.toString(),
        fxSource: fxData.source,
      },
      'Normalized price to USD'
    );

    return ok(normalizedPrice);
  }

  /**
   * Update transaction in database with normalized price data
   */
  private async updateTransactionPrices(tx: UniversalTransaction): Promise<Result<void, Error>> {
    try {
      // Pass the complete enriched transaction to the repository
      return await this.transactionRepository.updateMovementsWithPrices(tx);
    } catch (error) {
      return wrapError(error, `Failed to update transaction ${tx.id}`);
    }
  }
}
