// Handler for view prices command

import type { UniversalTransaction } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { PriceCoverageInfo, ViewPricesParams, ViewPricesResult } from './view-prices-utils.ts';

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
    const txResult = await this.txRepo.getTransactions(params.source);

    if (txResult.isErr()) {
      return wrapError(txResult.error, 'Failed to fetch transactions');
    }

    const transactions = txResult.value;

    // Group transactions by asset and calculate price coverage
    const { coverageMap, uniqueTransactionIds } = this.calculatePriceCoverage(transactions, params.asset);

    // Convert map to array and sort by asset name
    let coverageArray = Array.from(coverageMap.values()).sort((a, b) => a.asset.localeCompare(b.asset));

    // Filter by missing-only if requested
    if (params.missingOnly) {
      coverageArray = coverageArray.filter((c) => c.missing_price > 0);
    }

    // Calculate summary statistics from unique transaction IDs to avoid double-counting
    const summary = this.calculateSummary(coverageArray, uniqueTransactionIds);

    const result: ViewPricesResult = {
      coverage: coverageArray,
      summary,
    };

    return ok(result);
  }

  destroy(): void {
    // No cleanup needed
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
    const coverageMap = new Map<string, PriceCoverageInfo>();
    const uniqueTransactionIds = new Set<number>();

    for (const tx of transactions) {
      // Collect all movements from this transaction
      const allMovements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? [])];

      // Track which assets in this transaction have price data
      const assetPriceStatus = new Map<string, boolean>();

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
          // If we already saw this asset but it didn't have a price, update to true
          assetPriceStatus.set(asset, true);
        }
      }

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
