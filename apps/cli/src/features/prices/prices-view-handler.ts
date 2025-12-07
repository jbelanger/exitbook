// Handler for view prices command

import type { UniversalTransaction } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import { getAllMovements } from '../shared/view-utils.js';

import type { ViewPricesParams, ViewPricesResult, PriceCoverageInfo } from './prices-view-utils.js';

/**
 * Handler for viewing price coverage.
 */
export class ViewPricesHandler {
  constructor(private readonly txRepo: TransactionRepository) {}

  /**
   * Execute the view prices command.
   */
  async execute(params: ViewPricesParams): Promise<Result<ViewPricesResult, Error>> {
    // Fetch transactions from repository
    const txResult = await this.txRepo.getTransactions(params.source ? { sourceName: params.source } : undefined);

    if (txResult.isErr()) {
      return wrapError(txResult.error, 'Failed to fetch transactions');
    }

    const transactions = txResult.value;

    // Group transactions by asset and calculate price coverage
    const { coverageMap, uniqueTransactionIds } = this.calculatePriceCoverage(transactions, params.asset);

    // Convert map to array and sort by asset name
    const allCoverageArray = Array.from(coverageMap.values()).sort((a, b) => a.asset.localeCompare(b.asset));

    // Calculate summary statistics from ALL coverage data (before filtering)
    const summary = this.calculateSummary(allCoverageArray, uniqueTransactionIds);

    // Filter by missing-only if requested (for display purposes)
    const displayCoverageArray = params.missingOnly
      ? allCoverageArray.filter((c) => c.missing_price > 0)
      : allCoverageArray;

    const result: ViewPricesResult = {
      coverage: displayCoverageArray,
      summary,
    };

    return ok(result);
  }

  destroy(): void {
    // No cleanup needed
  }

  /**
   * Extract price status for each asset in a transaction.
   * Returns a map of asset -> hasPrice, where hasPrice is true if ANY movement of that asset has price data.
   */
  private extractAssetPriceStatus(tx: UniversalTransaction, assetFilter?: string): Map<string, boolean> {
    const assetPriceStatus = new Map<string, boolean>();
    const allMovements = getAllMovements(tx.movements);

    for (const movement of allMovements) {
      const asset = movement.asset;

      // Apply asset filter if provided
      if (assetFilter && asset !== assetFilter) {
        continue;
      }

      // Check if this movement has price data
      const hasPrice = movement.priceAtTxTime !== undefined && movement.priceAtTxTime !== null;

      // Track if ANY movement of this asset in this transaction has a price
      if (!assetPriceStatus.has(asset)) {
        assetPriceStatus.set(asset, hasPrice);
      } else if (hasPrice) {
        assetPriceStatus.set(asset, true);
      }
    }

    return assetPriceStatus;
  }

  /**
   * Aggregate coverage statistics across all transactions.
   * Builds a map of asset -> coverage info and tracks unique transaction IDs.
   */
  private aggregateCoverage(
    transactions: UniversalTransaction[],
    assetFilter?: string
  ): {
    coverageMap: Map<string, PriceCoverageInfo>;
    uniqueTransactionIds: Set<number>;
  } {
    const coverageMap = new Map<string, PriceCoverageInfo>();
    const uniqueTransactionIds = new Set<number>();

    for (const tx of transactions) {
      const assetPriceStatus = this.extractAssetPriceStatus(tx, assetFilter);

      // If this transaction has any matching assets, track it
      if (assetPriceStatus.size > 0) {
        uniqueTransactionIds.add(tx.id);
      }

      // Update coverage statistics for each asset found in this transaction
      for (const [asset, hasPrice] of assetPriceStatus.entries()) {
        // Get or create coverage entry for this asset
        if (!coverageMap.has(asset)) {
          coverageMap.set(asset, {
            asset,
            total_transactions: 0,
            with_price: 0,
            missing_price: 0,
            coverage_percentage: 0,
          });
        }

        const coverage = coverageMap.get(asset)!;
        coverage.total_transactions++;

        if (hasPrice) {
          coverage.with_price++;
        } else {
          coverage.missing_price++;
        }
      }
    }

    // Calculate coverage percentages
    for (const coverage of coverageMap.values()) {
      if (coverage.total_transactions > 0) {
        coverage.coverage_percentage = (coverage.with_price / coverage.total_transactions) * 100;
      }
    }

    return { coverageMap, uniqueTransactionIds };
  }

  /**
   * Calculate price coverage grouped by asset.
   * For each transaction, check ALL movements (inflows and outflows) to determine price coverage per asset.
   * Returns both the coverage map and a set of unique transaction IDs that were processed.
   */
  private calculatePriceCoverage(
    transactions: UniversalTransaction[],
    assetFilter?: string
  ): {
    coverageMap: Map<string, PriceCoverageInfo>;
    uniqueTransactionIds: Set<number>;
  } {
    return this.aggregateCoverage(transactions, assetFilter);
  }

  /**
   * Calculate summary statistics across all assets.
   * Uses unique transaction IDs to avoid double-counting multi-asset transactions.
   */
  private calculateSummary(coverage: PriceCoverageInfo[], uniqueTransactionIds: Set<number>) {
    // Sum of asset-transaction pairs (these can be > unique transactions for multi-asset txs)
    const totalAssetTransactions = coverage.reduce((sum, c) => sum + c.total_transactions, 0);
    const withPrice = coverage.reduce((sum, c) => sum + c.with_price, 0);
    const missingPrice = coverage.reduce((sum, c) => sum + c.missing_price, 0);
    const overallCoverage = totalAssetTransactions > 0 ? (withPrice / totalAssetTransactions) * 100 : 0;

    return {
      total_transactions: uniqueTransactionIds.size, // Actual number of unique transactions analyzed
      with_price: withPrice,
      missing_price: missingPrice,
      overall_coverage_percentage: overallCoverage,
    };
  }
}
