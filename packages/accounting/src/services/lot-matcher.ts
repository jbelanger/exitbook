import type { AssetMovement } from '@exitbook/core';
import type { StoredTransaction } from '@exitbook/data';
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
  match(transactions: StoredTransaction[], config: LotMatcherConfig): Result<LotMatchResult, Error> {
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
    transactions: StoredTransaction[],
    config: LotMatcherConfig
  ): Result<AssetLotMatchResult, Error> {
    try {
      // Sort transactions chronologically
      const sortedTransactions = [...transactions].sort(
        (a, b) => new Date(a.transaction_datetime).getTime() - new Date(b.transaction_datetime).getTime()
      );

      const lots: AcquisitionLot[] = [];
      const disposals: LotDisposal[] = [];

      // Process each transaction
      for (const tx of sortedTransactions) {
        // Check inflows (acquisitions)
        for (const inflow of tx.movements_inflows) {
          if (inflow.asset === asset) {
            const lot = this.createLotFromInflow(tx, inflow, config);
            lots.push(lot);
          }
        }

        // Check outflows (disposals)
        for (const outflow of tx.movements_outflows) {
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
    transaction: StoredTransaction,
    inflow: StoredTransaction['movements_inflows'][0],
    config: LotMatcherConfig
  ): AcquisitionLot {
    if (!inflow.priceAtTxTime) {
      throw new Error(`Inflow missing priceAtTxTime: transaction ${transaction.id}, asset ${inflow.asset}`);
    }

    const quantity = inflow.amount;
    const costBasisPerUnit = inflow.priceAtTxTime.price.amount;

    return createAcquisitionLot({
      id: uuidv4(),
      calculationId: config.calculationId,
      acquisitionTransactionId: transaction.id,
      asset: inflow.asset,
      quantity,
      costBasisPerUnit,
      method: config.strategy.getName(),
      transactionDate: new Date(transaction.transaction_datetime),
    });
  }

  /**
   * Match an outflow (disposal) to existing acquisition lots
   */
  private matchOutflowToLots(
    transaction: StoredTransaction,
    outflow: StoredTransaction['movements_outflows'][0],
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

      // Create disposal request
      const disposal = {
        transactionId: transaction.id,
        asset: outflow.asset,
        quantity: outflow.amount,
        date: new Date(transaction.transaction_datetime),
        proceedsPerUnit: outflow.priceAtTxTime.price.amount,
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
  private groupTransactionsByAsset(transactions: StoredTransaction[]): Map<string, StoredTransaction[]> {
    const assetMap = new Map<string, Set<number>>();

    // Collect unique assets
    for (const tx of transactions) {
      for (const inflow of tx.movements_inflows) {
        if (!assetMap.has(inflow.asset)) {
          assetMap.set(inflow.asset, new Set());
        }
        assetMap.get(inflow.asset)!.add(tx.id);
      }

      for (const outflow of tx.movements_outflows) {
        if (!assetMap.has(outflow.asset)) {
          assetMap.set(outflow.asset, new Set());
        }
        assetMap.get(outflow.asset)!.add(tx.id);
      }
    }

    // Build map of asset -> transactions
    const result = new Map<string, StoredTransaction[]>();
    for (const [asset, txIds] of assetMap) {
      const txsForAsset = transactions.filter((tx) => txIds.has(tx.id));
      result.set(asset, txsForAsset);
    }

    return result;
  }

  /**
   * Find transactions that are missing price data on any movements
   */
  private findTransactionsWithoutPrices(transactions: StoredTransaction[]): StoredTransaction[] {
    return transactions.filter((tx) => {
      const inflowsWithoutPrice = tx.movements_inflows.some((m: AssetMovement) => !m.priceAtTxTime);
      const outflowsWithoutPrice = tx.movements_outflows.some((m: AssetMovement) => !m.priceAtTxTime);
      return inflowsWithoutPrice || outflowsWithoutPrice;
    });
  }
}
