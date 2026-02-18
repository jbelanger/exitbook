// Handler for view prices command

import type { UniversalTransactionData } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { TransactionQueries } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import { getAllMovements } from '../shared/view-utils.js';

import type {
  AssetBreakdownEntry,
  MissingPriceMovement,
  PriceCoverageDetail,
  PriceCoverageInfo,
  ViewPricesParams,
  ViewPricesResult,
} from './prices-view-utils.js';

/**
 * Result of executeMissing.
 */
export interface MissingPricesResult {
  movements: MissingPriceMovement[];
  assetBreakdown: AssetBreakdownEntry[];
}

/**
 * Handler for viewing price coverage.
 */
export class ViewPricesHandler {
  constructor(private readonly txRepo: TransactionQueries) {}

  /**
   * Execute the view prices command (coverage mode).
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
    const allCoverageArray = Array.from(coverageMap.values()).sort((a, b) =>
      a.assetSymbol.localeCompare(b.assetSymbol)
    );

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

  /**
   * Execute coverage with enhanced detail (source breakdown + date range).
   */
  async executeCoverageDetail(params: ViewPricesParams): Promise<Result<PriceCoverageDetail[], Error>> {
    const txResult = await this.txRepo.getTransactions(params.source ? { sourceName: params.source } : undefined);

    if (txResult.isErr()) {
      return wrapError(txResult.error, 'Failed to fetch transactions');
    }

    const transactions = txResult.value;
    const detailMap = new Map<
      string,
      {
        base: PriceCoverageInfo;
        earliest: string;
        latest: string;
        missingSources: Map<string, number>;
        sources: Map<string, number>;
      }
    >();

    for (const tx of transactions) {
      const assetPriceStatus = this.extractAssetPriceStatus(tx, params.asset);

      for (const [asset, hasPrice] of assetPriceStatus.entries()) {
        if (!detailMap.has(asset)) {
          detailMap.set(asset, {
            base: {
              assetSymbol: asset,
              total_transactions: 0,
              with_price: 0,
              missing_price: 0,
              coverage_percentage: 0,
            },
            sources: new Map(),
            missingSources: new Map(),
            earliest: tx.datetime,
            latest: tx.datetime,
          });
        }

        const detail = detailMap.get(asset)!;
        detail.base.total_transactions++;

        if (hasPrice) {
          detail.base.with_price++;
        } else {
          detail.base.missing_price++;
          detail.missingSources.set(tx.source, (detail.missingSources.get(tx.source) ?? 0) + 1);
        }

        detail.sources.set(tx.source, (detail.sources.get(tx.source) ?? 0) + 1);

        if (tx.datetime < detail.earliest) detail.earliest = tx.datetime;
        if (tx.datetime > detail.latest) detail.latest = tx.datetime;
      }
    }

    // Calculate percentages and build result
    const result: PriceCoverageDetail[] = [];
    for (const detail of detailMap.values()) {
      if (detail.base.total_transactions > 0) {
        detail.base.coverage_percentage = (detail.base.with_price / detail.base.total_transactions) * 100;
      }

      result.push({
        ...detail.base,
        sources: Array.from(detail.sources.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        missingSources: Array.from(detail.missingSources.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        dateRange: { earliest: detail.earliest, latest: detail.latest },
      });
    }

    result.sort((a, b) => a.coverage_percentage - b.coverage_percentage || a.assetSymbol.localeCompare(b.assetSymbol));

    // Apply missing-only filter
    const filtered = params.missingOnly ? result.filter((c) => c.missing_price > 0) : result;

    return ok(filtered);
  }

  /**
   * Execute missing mode — returns flat movement rows + asset breakdown.
   */
  async executeMissing(params: ViewPricesParams): Promise<Result<MissingPricesResult, Error>> {
    const txResult = await this.txRepo.getTransactions(params.source ? { sourceName: params.source } : undefined);

    if (txResult.isErr()) {
      return wrapError(txResult.error, 'Failed to fetch transactions');
    }

    const transactions = txResult.value;
    const movements: MissingPriceMovement[] = [];
    const assetMap = new Map<string, { count: number; sourceCounts: Map<string, number> }>();

    for (const tx of transactions) {
      const inflows = tx.movements.inflows ?? [];
      const outflows = tx.movements.outflows ?? [];

      for (const movement of inflows) {
        if (params.asset && movement.assetSymbol !== params.asset) continue;
        if (movement.priceAtTxTime !== undefined && movement.priceAtTxTime !== null) continue;

        movements.push({
          transactionId: tx.id,
          source: tx.source,
          datetime: tx.datetime,
          assetSymbol: movement.assetSymbol,
          amount: movement.grossAmount.toFixed(),
          direction: 'inflow',
          operationCategory: tx.operation.category,
          operationType: tx.operation.type,
        });

        const entry = assetMap.get(movement.assetSymbol) ?? { count: 0, sourceCounts: new Map<string, number>() };
        entry.count++;
        entry.sourceCounts.set(tx.source, (entry.sourceCounts.get(tx.source) ?? 0) + 1);
        assetMap.set(movement.assetSymbol, entry);
      }

      for (const movement of outflows) {
        if (params.asset && movement.assetSymbol !== params.asset) continue;
        if (movement.priceAtTxTime !== undefined && movement.priceAtTxTime !== null) continue;

        movements.push({
          transactionId: tx.id,
          source: tx.source,
          datetime: tx.datetime,
          assetSymbol: movement.assetSymbol,
          amount: movement.grossAmount.toFixed(),
          direction: 'outflow',
          operationCategory: tx.operation.category,
          operationType: tx.operation.type,
        });

        const entry = assetMap.get(movement.assetSymbol) ?? { count: 0, sourceCounts: new Map<string, number>() };
        entry.count++;
        entry.sourceCounts.set(tx.source, (entry.sourceCounts.get(tx.source) ?? 0) + 1);
        assetMap.set(movement.assetSymbol, entry);
      }
    }

    // Sort movements by datetime
    movements.sort((a, b) => a.datetime.localeCompare(b.datetime));

    // Build asset breakdown with per-source counts
    const assetBreakdown: AssetBreakdownEntry[] = Array.from(assetMap.entries())
      .map(([assetSymbol, { count, sourceCounts }]) => ({
        assetSymbol,
        count,
        sources: Array.from(sourceCounts.entries())
          .map(([name, sourceCount]) => ({ name, count: sourceCount }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count);

    return ok({ movements, assetBreakdown });
  }

  /**
   * Extract price status for each asset in a transaction.
   * Returns a map of asset -> hasPrice, where hasPrice is true if ANY movement of that asset has price data.
   */
  private extractAssetPriceStatus(tx: UniversalTransactionData, assetFilter?: string): Map<string, boolean> {
    const assetPriceStatus = new Map<string, boolean>();
    const allMovements = getAllMovements(tx.movements);

    for (const movement of allMovements) {
      const asset = movement.assetSymbol;

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
    transactions: UniversalTransactionData[],
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
            assetSymbol: asset,
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
    transactions: UniversalTransactionData[],
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
