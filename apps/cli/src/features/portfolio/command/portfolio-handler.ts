import { PortfolioHandler } from '@exitbook/accounting';
import { buildCostBasisFailureSnapshotStore, buildCostBasisPorts } from '@exitbook/data/accounting';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { calculateBalances } from '@exitbook/ingestion';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';
import { ensureConsumerInputsReady } from '../../shared/consumer-input-readiness.js';
import { readCostBasisDependencyWatermark } from '../../shared/cost-basis-dependency-watermark-runtime.js';

/**
 * Create a CLI-wired PortfolioHandler.
 * The CLI owns prerequisite orchestration, runtime setup, and adapter wiring.
 */
export async function createPortfolioHandler(
  ctx: CommandRuntime,
  options: {
    asOf: Date;
    isJsonMode: boolean;
    profileId: number;
    profileKey: string;
  }
): Promise<Result<PortfolioHandler, Error>> {
  try {
    const database = await ctx.database();
    const dataDir = ctx.dataDir;
    const accountingExclusionPolicyResult = await loadAccountingExclusionPolicy(dataDir, options.profileKey);
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
      profileId: options.profileId,
      profileKey: options.profileKey,
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

    prereqAbort = undefined;
    return ok(
      new PortfolioHandler({
        accountingExclusionPolicy,
        calculateHoldings: (transactions) => calculateBalances(transactions),
        costBasisStore: buildCostBasisPorts(database, options.profileId),
        failureSnapshotStore: buildCostBasisFailureSnapshotStore(database),
        priceRuntime: priceRuntimeResult.value,
        readAssetReviewSummaries: () => readAssetReviewProjectionSummaries(database, options.profileId),
        readDependencyWatermark: () =>
          readCostBasisDependencyWatermark(database, ctx.dataDir, accountingExclusionPolicy, options.profileId),
      })
    );
  } catch (error) {
    return wrapError(error, 'Failed to create portfolio handler');
  }
}
