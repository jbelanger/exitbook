import { Currency, type AssetMovement, type UniversalTransaction } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

import { createAcquisitionLot } from '../domain/lot.js';
import type { AcquisitionLot, LotDisposal } from '../domain/schemas.js';

import type { ICostBasisStrategy } from './strategies/base-strategy.js';

/**
 * Configuration for lot matching
 */
export interface LotMatcherConfig {
  /** Calculation ID to associate lots with */
  calculationId: string;
  /** Cost basis strategy to use (FIFO, LIFO, etc.) */
  strategy: ICostBasisStrategy;
}

/**
 * Result of lot matching for a single asset
 */
export interface AssetLotMatchResult {
  /** Asset symbol */
  asset: string;
  /** Acquisition lots created */
  lots: AcquisitionLot[];
  /** Disposals matched to lots */
  disposals: LotDisposal[];
}

/**
 * Result of lot matching across all assets
 */
export interface LotMatchResult {
  /** Results grouped by asset */
  assetResults: AssetLotMatchResult[];
  /** Total number of acquisition lots created */
  totalLotsCreated: number;
  /** Total number of disposals processed */
  totalDisposalsProcessed: number;
}

/**
 * LotMatcher - Matches disposal transactions to acquisition lots using a specified strategy
 *
 * This service:
 * 1. Groups transactions by asset
 * 2. Creates acquisition lots from inflow transactions
 * 3. Matches outflow transactions (disposals) to acquisition lots using the specified strategy
 * 4. Returns lots and disposals for storage
 *
 * Note: Transactions must have priceAtTxTime populated on all movements before matching.
 */
export class LotMatcher {
  /**
   * Match transactions to create acquisition lots and disposals
   *
   * @param transactions - List of transactions to process (must have prices populated)
   * @param config - Matching configuration
   * @returns Result containing lots and disposals grouped by asset
   */
  match(transactions: UniversalTransaction[], config: LotMatcherConfig): Result<LotMatchResult, Error> {
    try {
      // Validate all transactions have prices
      const missingPrices = this.findTransactionsWithoutPrices(transactions);
      if (missingPrices.length > 0) {
        return err(
          new Error(
            `Cannot calculate cost basis: ${missingPrices.length} transactions missing price data. ` +
              `Transaction IDs: ${missingPrices.map((t) => t.id).join(', ')}`
          )
        );
      }

      // Group transactions by asset
      const transactionsByAsset = this.groupTransactionsByAsset(transactions);

      // Process each asset separately
      const assetResults: AssetLotMatchResult[] = [];

      for (const [asset, assetTransactions] of transactionsByAsset) {
        const result = this.matchAsset(asset, assetTransactions, config);
        if (result.isErr()) {
          return err(result.error);
        }
        assetResults.push(result.value);
      }

      // Calculate totals
      const totalLotsCreated = assetResults.reduce((sum, r) => sum + r.lots.length, 0);
      const totalDisposalsProcessed = assetResults.reduce((sum, r) => sum + r.disposals.length, 0);

      return ok({
        assetResults,
        totalLotsCreated,
        totalDisposalsProcessed,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Match transactions for a single asset
   */
  private matchAsset(
    asset: string,
    transactions: UniversalTransaction[],
    config: LotMatcherConfig
  ): Result<AssetLotMatchResult, Error> {
    try {
      // Sort transactions chronologically
      const sortedTransactions = [...transactions].sort(
        (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
      );

      const lots: AcquisitionLot[] = [];
      const disposals: LotDisposal[] = [];

      // Skip fiat currencies - we only track cost basis for crypto assets
      const assetCurrency = Currency.create(asset);
      if (assetCurrency.isFiat()) {
        return ok({
          asset,
          lots: [],
          disposals: [],
        });
      }

      // Process each transaction
      for (const tx of sortedTransactions) {
        // Check inflows (acquisitions)
        const inflows = tx.movements.inflows || [];
        for (const inflow of inflows) {
          if (inflow.asset === asset) {
            const lot = this.createLotFromInflow(tx, inflow, config);
            lots.push(lot);
          }
        }

        // Check outflows (disposals)
        const outflows = tx.movements.outflows || [];
        for (const outflow of outflows) {
          if (outflow.asset === asset) {
            const result = this.matchOutflowToLots(tx, outflow, lots, config);
            if (result.isErr()) {
              return err(result.error);
            }
            disposals.push(...result.value);
          }
        }
      }

      return ok({
        asset,
        lots,
        disposals,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Create an acquisition lot from an inflow movement
   */
  private createLotFromInflow(
    transaction: UniversalTransaction,
    inflow: AssetMovement,
    config: LotMatcherConfig
  ): AcquisitionLot {
    if (!inflow.priceAtTxTime) {
      throw new Error(`Inflow missing priceAtTxTime: transaction ${transaction.id}, asset ${inflow.asset}`);
    }

    const quantity = inflow.amount;
    const basePrice = inflow.priceAtTxTime.price.amount;

    // Calculate fees attributable to this acquisition
    // Fees increase the cost basis (you paid more to acquire the asset)
    const feeAmount = this.calculateFeesInFiat(transaction, inflow.asset);

    // Total cost basis = (quantity * price) + fees
    // Cost basis per unit = total cost basis / quantity
    const totalCostBasis = quantity.times(basePrice).plus(feeAmount);
    const costBasisPerUnit = totalCostBasis.dividedBy(quantity);

    return createAcquisitionLot({
      id: uuidv4(),
      calculationId: config.calculationId,
      acquisitionTransactionId: transaction.id,
      asset: inflow.asset,
      quantity,
      costBasisPerUnit,
      method: config.strategy.getName(),
      transactionDate: new Date(transaction.datetime),
    });
  }

  /**
   * Match an outflow (disposal) to existing acquisition lots
   */
  private matchOutflowToLots(
    transaction: UniversalTransaction,
    outflow: AssetMovement,
    allLots: AcquisitionLot[],
    config: LotMatcherConfig
  ): Result<LotDisposal[], Error> {
    try {
      if (!outflow.priceAtTxTime) {
        return err(new Error(`Outflow missing priceAtTxTime: transaction ${transaction.id}, asset ${outflow.asset}`));
      }

      // Find open lots for this asset
      const openLots = allLots.filter(
        (lot) => lot.asset === outflow.asset && (lot.status === 'open' || lot.status === 'partially_disposed')
      );

      // Calculate fees attributable to this disposal
      // Fees reduce the proceeds (you received less from the sale)
      const feeAmount = this.calculateFeesInFiat(transaction, outflow.asset);

      // Gross proceeds = quantity * price
      // Net proceeds per unit = (gross proceeds - fees) / quantity
      const grossProceeds = outflow.amount.times(outflow.priceAtTxTime.price.amount);
      const netProceeds = grossProceeds.minus(feeAmount);
      const proceedsPerUnit = netProceeds.dividedBy(outflow.amount);

      // Create disposal request
      const disposal = {
        transactionId: transaction.id,
        asset: outflow.asset,
        quantity: outflow.amount,
        date: new Date(transaction.datetime),
        proceedsPerUnit,
      };

      // Use strategy to match disposal to lots
      try {
        const lotDisposals = config.strategy.matchDisposal(disposal, openLots);

        // Update lot statuses and remaining quantities
        for (const lotDisposal of lotDisposals) {
          const lot = allLots.find((l) => l.id === lotDisposal.lotId);
          if (!lot) {
            return err(new Error(`Lot ${lotDisposal.lotId} not found`));
          }

          // Update remaining quantity
          lot.remainingQuantity = lot.remainingQuantity.minus(lotDisposal.quantityDisposed);

          // Update status
          if (lot.remainingQuantity.isZero()) {
            lot.status = 'fully_disposed';
          } else if (lot.remainingQuantity.lt(lot.quantity)) {
            lot.status = 'partially_disposed';
          }

          lot.updatedAt = new Date();
        }

        return ok(lotDisposals);
      } catch (error) {
        return err(error instanceof Error ? error : new Error(String(error)));
      }
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Group transactions by asset (from both inflows and outflows)
   */
  private groupTransactionsByAsset(transactions: UniversalTransaction[]): Map<string, UniversalTransaction[]> {
    const assetMap = new Map<string, Set<number>>();

    // Collect unique assets
    for (const tx of transactions) {
      const inflows = tx.movements.inflows || [];
      for (const inflow of inflows) {
        if (!assetMap.has(inflow.asset)) {
          assetMap.set(inflow.asset, new Set());
        }
        assetMap.get(inflow.asset)!.add(tx.id);
      }

      const outflows = tx.movements.outflows || [];
      for (const outflow of outflows) {
        if (!assetMap.has(outflow.asset)) {
          assetMap.set(outflow.asset, new Set());
        }
        assetMap.get(outflow.asset)!.add(tx.id);
      }
    }

    // Build map of asset -> transactions
    const result = new Map<string, UniversalTransaction[]>();
    for (const [asset, txIds] of assetMap) {
      const txsForAsset = transactions.filter((tx) => txIds.has(tx.id));
      result.set(asset, txsForAsset);
    }

    return result;
  }

  /**
   * Find transactions that are missing price data on any non-fiat movements
   *
   * Fiat currencies are excluded from validation since we don't track cost basis for them.
   */
  private findTransactionsWithoutPrices(transactions: UniversalTransaction[]): UniversalTransaction[] {
    return transactions.filter((tx) => {
      const inflows = tx.movements.inflows || [];
      const outflows = tx.movements.outflows || [];

      // Filter out fiat currencies - we only care about crypto asset prices
      const nonFiatInflows = inflows.filter((m) => {
        try {
          return !Currency.create(m.asset).isFiat();
        } catch {
          // If we can't create a Currency, assume it's crypto
          return true;
        }
      });

      const nonFiatOutflows = outflows.filter((m) => {
        try {
          return !Currency.create(m.asset).isFiat();
        } catch {
          // If we can't create a Currency, assume it's crypto
          return true;
        }
      });

      const inflowsWithoutPrice = nonFiatInflows.some((m) => !m.priceAtTxTime);
      const outflowsWithoutPrice = nonFiatOutflows.some((m) => !m.priceAtTxTime);
      return inflowsWithoutPrice || outflowsWithoutPrice;
    });
  }

  /**
   * Calculate the fiat value of fees attributable to a specific asset movement
   *
   * Fees are allocated proportionally based on the fiat value of non-fiat crypto movements.
   * Fiat movements are excluded from the allocation since we don't track cost basis for fiat.
   * For a transaction with multiple crypto assets, each asset gets a proportional share of the total fees.
   *
   * @param transaction - Transaction containing fees
   * @param targetAsset - The asset to calculate fees for
   * @returns Total fee amount in fiat (same currency as movement prices)
   */
  private calculateFeesInFiat(transaction: UniversalTransaction, targetAsset: string): Decimal {
    // Collect all fees
    const fees: AssetMovement[] = [];
    if (transaction.fees.platform) {
      fees.push(transaction.fees.platform);
    }
    if (transaction.fees.network) {
      fees.push(transaction.fees.network);
    }

    // If no fees, return zero
    if (fees.length === 0) {
      return new Decimal(0);
    }

    // Calculate total fee value in fiat
    let totalFeeValue = new Decimal(0);
    for (const fee of fees) {
      if (fee.priceAtTxTime) {
        const feeValue = fee.amount.times(fee.priceAtTxTime.price.amount);
        totalFeeValue = totalFeeValue.plus(feeValue);
      }
      // If fee doesn't have a price, we can't include it in the calculation
      // This is acceptable as it's conservative (understates basis/proceeds)
    }

    // Calculate total value of non-fiat movements to determine proportional allocation
    // We exclude fiat currencies since we don't track cost basis for them
    const inflows = transaction.movements.inflows || [];
    const outflows = transaction.movements.outflows || [];
    const allMovements = [...inflows, ...outflows];
    const nonFiatMovements = allMovements.filter((m) => {
      try {
        return !Currency.create(m.asset).isFiat();
      } catch {
        // If we can't create a Currency, assume it's crypto
        return true;
      }
    });

    let totalMovementValue = new Decimal(0);
    let targetMovementValue = new Decimal(0);

    for (const movement of nonFiatMovements) {
      if (movement.priceAtTxTime) {
        const movementValue = movement.amount.times(movement.priceAtTxTime.price.amount);
        totalMovementValue = totalMovementValue.plus(movementValue);

        if (movement.asset === targetAsset) {
          targetMovementValue = targetMovementValue.plus(movementValue);
        }
      }
    }

    // If no non-fiat movements have values, split fees evenly among non-fiat assets
    if (totalMovementValue.isZero()) {
      const movementsForAsset = nonFiatMovements.filter((m) => m.asset === targetAsset).length;
      if (movementsForAsset === 0 || nonFiatMovements.length === 0) {
        return new Decimal(0);
      }
      return totalFeeValue.dividedBy(nonFiatMovements.length).times(movementsForAsset);
    }

    // Allocate fees proportionally based on non-fiat movement value
    return totalFeeValue.times(targetMovementValue).dividedBy(totalMovementValue);
  }
}
