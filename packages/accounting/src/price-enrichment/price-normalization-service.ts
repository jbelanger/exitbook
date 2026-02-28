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

import type { PriceAtTxTime, UniversalTransactionData } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { normalizeTransactionMovements } from './price-normalization-utils.js';
import type { TransactionNormalizationResult } from './price-normalization-utils.js';
import { normalizePriceToUSD as normalizePriceToUSDUtil } from './price-normalization-utils.js';
import type { IFxRateProvider } from './types.js';

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
    private readonly db: DataContext,
    private readonly fxRateProvider: IFxRateProvider
  ) {}

  /**
   * Normalize all non-USD fiat prices to USD
   *
   * Process:
   * 1. Find all transactions with movements that have prices
   * 2. For each movement with non-USD fiat price:
   *    a. Fetch FX rate via injected FxRateProvider (EUR→USD at tx time)
   *    b. Convert price.amount to USD
   *    c. Populate fxRateToUSD, fxSource, fxTimestamp metadata
   *    d. Update price.currency to 'USD'
   * 3. Skip crypto prices (they shouldn't exist yet, but log warning)
   * 4. Skip already-USD prices
   *
   * Note: Interactive behavior (manual FX entry) is handled by injecting
   * InteractiveFxRateProvider instead of StandardFxRateProvider.
   *
   * @returns Result with normalization statistics
   */
  async normalize(): Promise<Result<NormalizeResult, Error>> {
    try {
      logger.info('Starting price normalization (non-USD fiat → USD)');

      // Get all transactions (we need to check all for non-USD fiat prices)
      const txResult = await this.db.transactions.getTransactions();
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
      const transactionsToUpdate = new Map<number, UniversalTransactionData>();

      // Process each transaction using pure utility function
      for (const tx of transactions) {
        const normalizationResult = await this.normalizeTransaction(tx);

        // Handle logging and statistics (imperative shell)
        result.movementsNormalized += normalizationResult.movementsNormalized;
        result.movementsSkipped += normalizationResult.movementsSkipped;
        result.failures += normalizationResult.errors.length;
        result.errors.push(...normalizationResult.errors.map((e) => e.message));

        // Log warnings for crypto prices and count them as skipped
        for (const movement of normalizationResult.cryptoPriceMovements) {
          logger.warn(
            {
              txId: tx.id,
              asset: movement.assetSymbol,
              priceCurrency: movement.priceAtTxTime?.price.currency.toString(),
            },
            'Found crypto currency in price field (unexpected - prices should be in fiat)'
          );
          result.movementsSkipped++; // Crypto prices are counted as skipped
        }

        // Log individual errors
        for (const error of normalizationResult.errors) {
          logger.warn({ txId: tx.id, error: error.message }, 'Failed to normalize price');
        }

        // Track transaction for update if changes were made
        if (normalizationResult.transaction) {
          transactionsToUpdate.set(tx.id, normalizationResult.transaction);

          logger.debug(
            {
              txId: tx.id,
              movementsNormalized: normalizationResult.movementsNormalized,
            },
            'Transaction normalized'
          );
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
   * Normalize a single transaction using pure utility function
   * Delegates business logic to normalizeTransactionMovements, handles logging
   */
  private async normalizeTransaction(tx: UniversalTransactionData): Promise<TransactionNormalizationResult> {
    // Create a bound version of normalizePriceToUSD that captures this service's context
    const normalizePriceFn = async (price: PriceAtTxTime, date: Date) => {
      const result = await normalizePriceToUSDUtil(price, date, (currency, timestamp) =>
        this.fxRateProvider.getRateToUSD(currency, timestamp)
      );

      // Log successful normalization (imperative shell responsibility)
      if (result.isOk()) {
        const normalizedPrice = result.value;
        logger.debug(
          {
            originalCurrency: price.price.currency.toString(),
            originalAmount: price.price.amount.toFixed(),
            fxRate: normalizedPrice.fxRateToUSD?.toString(),
            usdAmount: normalizedPrice.price.amount.toFixed(),
            fxSource: normalizedPrice.fxSource,
          },
          'Normalized price to USD'
        );
      }

      return result;
    };

    // Delegate to pure utility function
    return normalizeTransactionMovements(tx, normalizePriceFn);
  }

  /**
   * Update transaction in database with normalized price data
   */
  private async updateTransactionPrices(tx: UniversalTransactionData): Promise<Result<void, Error>> {
    return this.db.executeInTransaction((txCtx) => txCtx.transactions.updateMovementsWithPrices(tx));
  }
}
