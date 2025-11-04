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

import type { AssetMovement, FeeMovement, PriceAtTxTime, UniversalTransaction } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { IFxRateProvider } from './fx-rate-provider.interface.ts';
import {
  createNormalizedPrice,
  extractMovementsNeedingNormalization,
  movementNeedsNormalization,
  validateFxRate,
} from './price-normalization-utils.ts';

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
        const normalizedTx = await this.normalizeTransaction(tx, result);
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
    result: NormalizeResult
  ): Promise<UniversalTransaction | undefined> {
    const inflows = tx.movements.inflows ?? [];
    const outflows = tx.movements.outflows ?? [];

    // Use pure function to classify movements
    const classification = extractMovementsNeedingNormalization(tx);

    // Update stats for skipped movements
    result.movementsSkipped += classification.skipped.length;

    // Log warnings for crypto prices (shouldn't exist in price field)
    for (const movement of classification.cryptoPrices) {
      logger.warn(
        {
          txId: tx.id,
          asset: movement.asset,
          priceCurrency: movement.priceAtTxTime?.price.currency.toString(),
        },
        'Found crypto currency in price field (unexpected - prices should be in fiat)'
      );
      result.movementsSkipped++;
    }

    // Check if any fees need normalization
    const feesNeedNormalization = (tx.fees ?? []).some((fee) => {
      if (!fee.priceAtTxTime) {
        return false;
      }
      const priceCurrency = fee.priceAtTxTime.price.currency;
      // Needs normalization if it's non-USD fiat
      return priceCurrency.toString() !== 'USD' && priceCurrency.isFiat();
    });

    // If no movements and no fees need normalization, skip this transaction
    if (classification.needsNormalization.length === 0 && !feesNeedNormalization) {
      return undefined;
    }

    logger.debug(
      {
        txId: tx.id,
        movementsToNormalize: classification.needsNormalization.length,
        feesToNormalize: (tx.fees ?? []).filter((fee) => {
          if (!fee.priceAtTxTime) return false;
          const priceCurrency = fee.priceAtTxTime.price.currency;
          return priceCurrency.toString() !== 'USD' && priceCurrency.isFiat();
        }).length,
      },
      'Normalizing transaction'
    );

    // Normalize each movement
    const normalizedInflows = await this.normalizeMovements(inflows, tx.datetime, result);
    const normalizedOutflows = await this.normalizeMovements(outflows, tx.datetime, result);

    // Normalize fees array
    const normalizedFees = await this.normalizeFees(tx.fees ?? [], tx.datetime, result);

    // Return updated transaction
    return {
      ...tx,
      movements: {
        inflows: normalizedInflows,
        outflows: normalizedOutflows,
      },
      fees: normalizedFees,
    };
  }

  /**
   * Normalize an array of movements
   */
  private async normalizeMovements(
    movements: AssetMovement[],
    txDatetime: string,
    result: NormalizeResult
  ): Promise<AssetMovement[]> {
    const normalized: AssetMovement[] = [];

    for (const movement of movements) {
      // Use pure function to check if normalization needed
      if (!movementNeedsNormalization(movement)) {
        normalized.push(movement);
        continue;
      }

      // Normalize this price
      const normalizedPrice = await this.normalizePriceToUSD(movement.priceAtTxTime!, new Date(txDatetime));

      if (normalizedPrice.isErr()) {
        const priceCurrency = movement.priceAtTxTime!.price.currency;
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
   * Normalize an array of fees
   */
  private async normalizeFees(
    fees: FeeMovement[],
    txDatetime: string,
    result: NormalizeResult
  ): Promise<FeeMovement[]> {
    const normalized: FeeMovement[] = [];

    for (const fee of fees) {
      // Skip if no price to normalize
      if (!fee.priceAtTxTime) {
        normalized.push(fee);
        continue;
      }

      const priceCurrency = fee.priceAtTxTime.price.currency;

      // Skip if already USD
      if (priceCurrency.toString() === 'USD') {
        normalized.push(fee);
        continue;
      }

      // Skip if not a fiat currency
      if (!priceCurrency.isFiat()) {
        normalized.push(fee);
        continue;
      }

      // Normalize this price
      const normalizedPrice = await this.normalizePriceToUSD(fee.priceAtTxTime, new Date(txDatetime));

      if (normalizedPrice.isErr()) {
        logger.warn(
          {
            asset: fee.asset,
            scope: fee.scope,
            settlement: fee.settlement,
            currency: priceCurrency.toString(),
            error: normalizedPrice.error.message,
          },
          'Failed to normalize fee price'
        );
        result.failures++;
        result.errors.push(`Fee ${fee.asset} (${priceCurrency.toString()} → USD): ${normalizedPrice.error.message}`);
        // Keep original price
        normalized.push(fee);
        continue;
      }

      // Success - update fee with normalized price
      result.movementsNormalized++;
      normalized.push({
        ...fee,
        priceAtTxTime: normalizedPrice.value,
      });
    }

    return normalized;
  }

  /**
   * Normalize a single fee (if it exists and needs normalization)
   */
  private async normalizeFee(
    fee: AssetMovement | undefined,
    txDatetime: string,
    result: NormalizeResult
  ): Promise<AssetMovement | undefined> {
    // No fee - return undefined
    if (!fee) {
      return undefined;
    }

    // Fee doesn't need normalization - return as-is
    if (!movementNeedsNormalization(fee)) {
      return fee;
    }

    // Normalize the fee price
    const normalizedPrice = await this.normalizePriceToUSD(fee.priceAtTxTime!, new Date(txDatetime));

    if (normalizedPrice.isErr()) {
      const priceCurrency = fee.priceAtTxTime!.price.currency;
      logger.warn(
        {
          feeAsset: fee.asset,
          currency: priceCurrency.toString(),
          error: normalizedPrice.error.message,
        },
        'Failed to normalize fee price'
      );
      result.failures++;
      result.errors.push(`Fee ${fee.asset} (${priceCurrency.toString()} → USD): ${normalizedPrice.error.message}`);
      // Keep original fee price
      return fee;
    }

    // Success - update fee with normalized price
    result.movementsNormalized++;
    return {
      ...fee,
      priceAtTxTime: normalizedPrice.value,
    };
  }

  /**
   * Normalize a single price from non-USD fiat to USD
   */
  private async normalizePriceToUSD(
    priceAtTxTime: PriceAtTxTime,
    timestamp: Date
  ): Promise<Result<PriceAtTxTime, Error>> {
    const sourceCurrency = priceAtTxTime.price.currency;
    const sourceAmount = priceAtTxTime.price.amount;

    // Fetch FX rate via injected provider
    // Provider might fetch from APIs or prompt user (depending on implementation)
    const fxRateResult = await this.fxRateProvider.getRateToUSD(sourceCurrency, timestamp);

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

    logger.debug(
      {
        originalCurrency: sourceCurrency.toString(),
        originalAmount: sourceAmount.toFixed(),
        fxRate: fxRate.toString(),
        usdAmount: normalizedPrice.price.amount.toFixed(),
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
