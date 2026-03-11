import { type AssetReviewSummary, type UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { ICostBasisPersistence } from '../../ports/cost-basis-persistence.js';
import { buildCostBasisScopedTransactions } from '../matching/build-cost-basis-scoped-transactions.js';
import { LotMatcher } from '../matching/lot-matcher.js';
import type { AccountingExclusionPolicy } from '../shared/accounting-exclusion-policy.js';
import { applyAccountingExclusionPolicy } from '../shared/accounting-exclusion-policy.js';
import { assertNoScopedAssetsRequireReview } from '../shared/asset-review-preflight.js';
import type { CostBasisConfig } from '../shared/cost-basis-config.js';
import { getJurisdictionRules, validateScopedTransactionPrices } from '../shared/cost-basis-utils.js';

import { calculateCostBasisFromScopedTransactions, type CostBasisSummary } from './cost-basis-calculator.js';

export type MissingPricePolicy = 'error' | 'exclude';

export interface CostBasisPipelineOptions {
  /**
   * How missing prices should be handled at the accounting boundary.
   *
   * `error` is for tax reporting surfaces where dropping a transaction would
   * understate realized activity and must fail closed.
   *
   * `exclude` is for portfolio-style surfaces where a partial open-lot view is
   * still useful, as long as the caller warns that unrealized P&L is incomplete.
   */
  missingPricePolicy: MissingPricePolicy;
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
}

export interface CostBasisPipelineResult {
  summary: CostBasisSummary;
  missingPricesCount: number;
  /**
   * Raw transactions carried forward into the final scoped rebuild. This can
   * include same-hash internal dependencies consumed by scoped reductions.
   */
  rebuildTransactions: UniversalTransactionData[];
}

const logger = getLogger('cost-basis-pipeline');

/**
 * Shared cost-basis pipeline: scoped build → price validation policy →
 * jurisdiction rules → lot matching → gain/loss.
 *
 * Used by CostBasisWorkflow and PortfolioHandler to avoid duplicating the
 * "validate prices → get rules → run calculator" flow.
 */
export async function runCostBasisPipeline(
  transactions: UniversalTransactionData[],
  config: CostBasisConfig,
  store: ICostBasisPersistence,
  options: CostBasisPipelineOptions
): Promise<Result<CostBasisPipelineResult, Error>> {
  const scopedResult = buildCostBasisScopedTransactions(transactions, logger);
  if (scopedResult.isErr()) {
    return err(scopedResult.error);
  }

  const priceValidatedScopedBuild = applyAccountingExclusionPolicy(
    scopedResult.value,
    options.accountingExclusionPolicy
  ).scopedBuildResult;

  const assetReviewResult = assertNoScopedAssetsRequireReview(
    priceValidatedScopedBuild.transactions,
    options.assetReviewSummaries
  );
  if (assetReviewResult.isErr()) {
    return err(assetReviewResult.error);
  }

  const validationResult = validateScopedTransactionPrices(priceValidatedScopedBuild, config.currency);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const { rebuildTransactions, missingPricesCount } = validationResult.value;

  if (options.missingPricePolicy === 'error' && missingPricesCount > 0) {
    return err(
      new Error(
        `${missingPricesCount} transactions are missing required price data. ` +
          `Run 'exitbook prices enrich' and retry cost basis.`
      )
    );
  }

  let rebuildScopedBuild = priceValidatedScopedBuild;
  if (options.missingPricePolicy === 'exclude' && missingPricesCount > 0) {
    logger.warn(
      {
        missingPricesCount,
        originalTransactionsCount: transactions.length,
        rebuildTransactionsCount: rebuildTransactions.length,
      },
      'Excluding transactions with missing prices from the soft cost-basis pipeline'
    );

    // Same-hash scoping mutates the scoped transaction set and may emit
    // fee-only carryovers. After excluding raw transactions we must rebuild the
    // scoped subset so those transfer decisions are recomputed against the
    // surviving transactions rather than leaving dangling carryover state.
    const rebuildScopedResult = buildCostBasisScopedTransactions(rebuildTransactions, logger);
    if (rebuildScopedResult.isErr()) {
      return err(rebuildScopedResult.error);
    }

    rebuildScopedBuild = applyAccountingExclusionPolicy(
      rebuildScopedResult.value,
      options.accountingExclusionPolicy
    ).scopedBuildResult;

    const rebuildAssetReviewResult = assertNoScopedAssetsRequireReview(
      rebuildScopedBuild.transactions,
      options.assetReviewSummaries
    );
    if (rebuildAssetReviewResult.isErr()) {
      return err(rebuildAssetReviewResult.error);
    }
  }

  const rulesResult = getJurisdictionRules(config.jurisdiction);
  if (rulesResult.isErr()) {
    return err(rulesResult.error);
  }

  const rules = rulesResult.value;

  // Load confirmed links from persistence
  const contextResult = await store.loadCostBasisContext();
  if (contextResult.isErr()) {
    return err(contextResult.error);
  }

  const lotMatcher = new LotMatcher();

  const costBasisResult = await calculateCostBasisFromScopedTransactions(
    rebuildScopedBuild,
    config,
    rules,
    lotMatcher,
    contextResult.value.confirmedLinks
  );
  if (costBasisResult.isErr()) {
    return err(costBasisResult.error);
  }

  return ok({ summary: costBasisResult.value, missingPricesCount, rebuildTransactions });
}
