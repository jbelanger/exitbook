import {
  PortfolioHandler,
  type IPortfolioDependencyReader,
  type IPortfolioHoldingsCalculator,
} from '@exitbook/accounting';
import { buildCostBasisFailureSnapshotStore, buildCostBasisPorts } from '@exitbook/data';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { calculateBalances } from '@exitbook/ingestion';

import type { CommandScope } from '../../../runtime/command-scope.js';
import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';
import { ensureConsumerInputsReady } from '../../shared/consumer-input-readiness.js';
import { readCostBasisDependencyWatermark } from '../../shared/cost-basis-dependency-watermark-runtime.js';

export { PortfolioHandler } from '@exitbook/accounting';

/**
 * Create a CLI-wired PortfolioHandler.
 * The CLI owns prerequisite orchestration, runtime setup, and adapter wiring.
 */
export async function createPortfolioHandler(
  ctx: CommandScope,
  options: {
    asOf: Date;
    isJsonMode: boolean;
  }
): Promise<Result<PortfolioHandler, Error>> {
  try {
    const database = await ctx.database();
    const dataDir = ctx.dataDir;
    const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(dataDir);
    if (accountingExclusionPolicyResult.isErr()) {
      return err(accountingExclusionPolicyResult.error);
    }
    const accountingExclusionPolicy = accountingExclusionPolicyResult.value;

    let prereqAbort: (() => void) | undefined;
    if (!options.isJsonMode) {
      ctx.onAbort(() => {
        prereqAbort?.();
      });
    }

    const readyResult = await ensureConsumerInputsReady(ctx, 'portfolio', {
      isJsonMode: options.isJsonMode,
      priceConfig: { startDate: new Date(0), endDate: options.asOf },
      accountingExclusionPolicy,
      setAbort: (abort) => {
        prereqAbort = abort;
      },
    });
    if (readyResult.isErr()) {
      return err(readyResult.error);
    }

    const priceRuntimeResult = await ctx.openPriceProviderRuntime();
    if (priceRuntimeResult.isErr()) {
      return err(new Error(`Failed to create price provider runtime: ${priceRuntimeResult.error.message}`));
    }

    const dependencyReader: IPortfolioDependencyReader = {
      readAssetReviewSummaries: () => readAssetReviewProjectionSummaries(database),
      readDependencyWatermark: () => readCostBasisDependencyWatermark(database, dataDir, accountingExclusionPolicy),
    };
    const holdingsCalculator: IPortfolioHoldingsCalculator = {
      calculateHoldings: (transactions) => calculateBalances(transactions),
    };

    prereqAbort = undefined;
    return ok(
      new PortfolioHandler({
        accountingExclusionPolicy,
        costBasisStore: buildCostBasisPorts(database),
        dependencyReader,
        failureSnapshotStore: buildCostBasisFailureSnapshotStore(database),
        holdingsCalculator,
        priceRuntime: priceRuntimeResult.value,
      })
    );
  } catch (error) {
    return wrapError(error, 'Failed to create portfolio handler');
  }
}
