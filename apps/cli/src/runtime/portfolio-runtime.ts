import {
  type AccountingExclusionPolicy,
  type IPortfolioDependencyReader,
  type IPortfolioHoldingsCalculator,
} from '@exitbook/accounting';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';
import { calculateBalances } from '@exitbook/ingestion';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import { readAssetReviewProjectionSummaries } from '../features/shared/asset-review-projection-store.js';
import { readCostBasisDependencyWatermark } from '../features/shared/cost-basis-dependency-watermark-runtime.js';

import type { CommandScope } from './command-scope.js';

export interface CliPortfolioRuntime {
  dependencyReader: IPortfolioDependencyReader;
  holdingsCalculator: IPortfolioHoldingsCalculator;
  priceRuntime: IPriceProviderRuntime;
}

export interface CreateCliPortfolioRuntimeOptions {
  accountingExclusionPolicy: AccountingExclusionPolicy;
  database: DataSession;
  scope: CommandScope;
}

export async function createCliPortfolioRuntime(
  options: CreateCliPortfolioRuntimeOptions
): Promise<Result<CliPortfolioRuntime, Error>> {
  const priceRuntimeResult = await options.scope.openPriceProviderRuntime();
  if (priceRuntimeResult.isErr()) {
    return err(new Error(`Failed to create price provider runtime: ${priceRuntimeResult.error.message}`));
  }

  const dataDir = options.scope.dataDir;

  return ok({
    dependencyReader: {
      readAssetReviewSummaries: () => readAssetReviewProjectionSummaries(options.database),
      readDependencyWatermark: () =>
        readCostBasisDependencyWatermark(options.database, dataDir, options.accountingExclusionPolicy),
    },
    holdingsCalculator: {
      calculateHoldings: (transactions) => calculateBalances(transactions),
    },
    priceRuntime: priceRuntimeResult.value,
  });
}
