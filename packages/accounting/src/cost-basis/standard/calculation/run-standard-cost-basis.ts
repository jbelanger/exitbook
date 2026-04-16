import { type AssetReviewSummary, type Transaction } from '@exitbook/core';
import { err, resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import {
  assertNoAccountingLayerAssetsRequireReview,
  type AccountingExclusionPolicy,
} from '../../../accounting-layer.js';
import { buildScopedAccountingLayerFromTransactions } from '../../../accounting-layer/build-accounting-layer-from-transactions.js';
import type { ICostBasisContextReader } from '../../../ports/cost-basis-persistence.js';
import { resolveCostBasisJurisdictionRules } from '../../jurisdictions/registry.js';
import type { CostBasisConfig } from '../../model/cost-basis-config.js';
import {
  stabilizeExcludedRebuildTransactions,
  validateAccountingLayerPrices,
} from '../../workflow/price-completeness.js';
import { LotMatcher } from '../matching/lot-matcher.js';

import { calculateCostBasisFromAccountingLayer, type CostBasisSummary } from './standard-calculator.js';

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
  return resultDoAsync(async function* () {
    const preparedAccountingLayer = yield* buildScopedAccountingLayerFromTransactions(
      transactions,
      logger,
      options.accountingExclusionPolicy
    );

    yield* assertNoAccountingLayerAssetsRequireReview(
      preparedAccountingLayer.accountingLayer,
      options.assetReviewSummaries
    );

    const validationResult = yield* validateAccountingLayerPrices(
      preparedAccountingLayer.accountingLayer,
      config.currency
    );

    let rebuildTransactions = validationResult.rebuildTransactions;
    const { missingPricesCount } = validationResult;

    if (options.missingPricePolicy === 'error' && missingPricesCount > 0) {
      return yield* err(
        new Error(
          `${missingPricesCount} transactions are missing required price data. ` +
            `Run 'exitbook prices enrich' and retry cost basis.`
        )
      );
    }

    let rebuildAccountingLayer = preparedAccountingLayer.accountingLayer;
    if (options.missingPricePolicy === 'exclude' && missingPricesCount > 0) {
      logger.warn(
        {
          missingPricesCount,
          originalTransactionsCount: transactions.length,
          rebuildTransactionsCount: rebuildTransactions.length,
        },
        'Excluding transactions with missing prices from the soft cost-basis pipeline'
      );

      rebuildTransactions = yield* stabilizeExcludedRebuildTransactions(
        rebuildTransactions,
        config.currency,
        options.accountingExclusionPolicy
      );

      // Same-hash scoping mutates the scoped transaction set and may emit
      // fee-only carryovers. After stabilizing the retained raw transactions we
      // must rebuild the scoped subset so those transfer decisions are recomputed
      // against the surviving transactions rather than leaving dangling carryover state.
      const rebuiltAccountingLayer = yield* buildScopedAccountingLayerFromTransactions(
        rebuildTransactions,
        logger,
        options.accountingExclusionPolicy
      );

      rebuildAccountingLayer = rebuiltAccountingLayer.accountingLayer;

      yield* assertNoAccountingLayerAssetsRequireReview(
        rebuiltAccountingLayer.accountingLayer,
        options.assetReviewSummaries
      );
    }

    const rules = yield* resolveCostBasisJurisdictionRules(config.jurisdiction);
    const context = yield* await store.loadCostBasisContext();

    const lotMatcher = new LotMatcher();
    const summary = yield* await calculateCostBasisFromAccountingLayer(
      rebuildAccountingLayer,
      config,
      rules,
      lotMatcher,
      context.confirmedLinks
    );

    return { summary, missingPricesCount, rebuildTransactions };
  });
}
