import { PortfolioHandler } from '@exitbook/accounting/portfolio';
import { buildCostBasisFailureSnapshotStore, buildCostBasisPorts } from '@exitbook/data/accounting';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { calculateBalances } from '@exitbook/ingestion/balance';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { readCostBasisDependencyWatermark } from '../../../runtime/cost-basis-dependency-watermark-runtime.js';
import { preparePricedConsumerRuntime } from '../../../runtime/priced-consumer-runtime.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';
import type { CliOutputFormat } from '../../shared/command-options.js';

/**
 * Create a CLI-wired PortfolioHandler.
 * The CLI owns prerequisite orchestration, runtime setup, and adapter wiring.
 */
export async function createPortfolioHandler(
  ctx: CommandRuntime,
  options: {
    asOf: Date;
    format: CliOutputFormat;
    profileId: number;
    profileKey: string;
  }
): Promise<Result<PortfolioHandler, Error>> {
  try {
    const database = await ctx.database();
    const pricedRuntimeResult = await preparePricedConsumerRuntime(ctx, {
      format: options.format,
      profileId: options.profileId,
      profileKey: options.profileKey,
      priceConfig: { startDate: new Date(0), endDate: options.asOf },
      target: 'portfolio',
    });
    if (pricedRuntimeResult.isErr()) {
      return err(pricedRuntimeResult.error);
    }
    return ok(
      new PortfolioHandler({
        accountingExclusionPolicy: pricedRuntimeResult.value.accountingExclusionPolicy,
        calculateHoldings: (transactions) => calculateBalances(transactions),
        costBasisStore: buildCostBasisPorts(database, options.profileId),
        failureSnapshotStore: buildCostBasisFailureSnapshotStore(database),
        priceRuntime: pricedRuntimeResult.value.priceRuntime,
        readAssetReviewSummaries: () => readAssetReviewProjectionSummaries(database, options.profileId),
        readDependencyWatermark: () =>
          readCostBasisDependencyWatermark(
            database,
            ctx.dataDir,
            pricedRuntimeResult.value.accountingExclusionPolicy,
            options.profileId
          ),
      })
    );
  } catch (error) {
    return wrapError(error, 'Failed to create portfolio handler');
  }
}
