import { type AssetReviewSummary, type Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { ICostBasisContextReader } from '../../../ports/cost-basis-persistence.js';
import { resolveCostBasisJurisdictionRules } from '../../jurisdictions/registry.js';
import type { CostBasisConfig } from '../../model/cost-basis-config.js';
import {
  stabilizeExcludedRebuildTransactions,
  validateScopedTransactionPrices,
} from '../../workflow/price-completeness.js';
import { buildCostBasisScopedTransactions } from '../matching/build-cost-basis-scoped-transactions.js';
import { LotMatcher } from '../matching/lot-matcher.js';
import type { AccountingExclusionPolicy } from '../validation/accounting-exclusion-policy.js';
import { applyAccountingExclusionPolicy } from '../validation/accounting-exclusion-policy.js';
import { assertNoScopedAssetsRequireReview } from '../validation/asset-review-preflight.js';

import { calculateCostBasisFromScopedTransactions, type CostBasisSummary } from './standard-calculator.js';

type MissingPricePolicy = 'error' | 'exclude';

interface CostBasisPipelineOptions {
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

interface CostBasisPipelineResult {
  summary: CostBasisSummary;
  missingPricesCount: number;
  /**
   * Raw transactions carried forward into the final stabilized scoped rebuild.
   */
  rebuildTransactions: Transaction[];
}

const logger = getLogger('cost-basis.standard.calculation');

/**
 * Shared cost-basis pipeline: scoped build → price validation policy →
 * jurisdiction rules → lot matching → gain/loss.
 *
 * Used by CostBasisWorkflow and PortfolioHandler to avoid duplicating the
 * "validate prices → get rules → run calculator" flow.
 */
export async function runCostBasisPipeline(
  transactions: Transaction[],
  config: CostBasisConfig,
  store: ICostBasisContextReader,
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

  let { rebuildTransactions } = validationResult.value;
  const { missingPricesCount } = validationResult.value;

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

    const stabilizedRebuildResult = stabilizeExcludedRebuildTransactions(
      rebuildTransactions,
      config.currency,
      options.accountingExclusionPolicy
    );
    if (stabilizedRebuildResult.isErr()) {
      return err(stabilizedRebuildResult.error);
    }

    rebuildTransactions = stabilizedRebuildResult.value;

    // Same-hash scoping mutates the scoped transaction set and may emit
    // fee-only carryovers. After stabilizing the retained raw transactions we
    // must rebuild the scoped subset so those transfer decisions are recomputed
    // against the surviving transactions rather than leaving dangling carryover state.
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

  const rulesResult = resolveCostBasisJurisdictionRules(config.jurisdiction);
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
