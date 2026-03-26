import { PortfolioHandler } from '@exitbook/accounting';
import { buildCostBasisFailureSnapshotStore, buildCostBasisPorts } from '@exitbook/data/accounting';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { createCliPortfolioRuntime } from '../../../runtime/portfolio-runtime.js';
import { loadAccountingExclusionPolicy } from '../../shared/accounting-exclusion-policy.js';
import { ensureConsumerInputsReady } from '../../shared/consumer-input-readiness.js';

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
      profileId: options.profileId,
      priceConfig: { startDate: new Date(0), endDate: options.asOf },
      accountingExclusionPolicy,
      setAbort: (abort) => {
        prereqAbort = abort;
      },
    });
    if (readyResult.isErr()) {
      return err(readyResult.error);
    }

    const portfolioRuntimeResult = await createCliPortfolioRuntime({
      accountingExclusionPolicy,
      database,
      profileId: options.profileId,
      scope: ctx,
    });
    if (portfolioRuntimeResult.isErr()) {
      return err(portfolioRuntimeResult.error);
    }
    const portfolioRuntime = portfolioRuntimeResult.value;

    prereqAbort = undefined;
    return ok(
      new PortfolioHandler({
        accountingExclusionPolicy,
        costBasisStore: buildCostBasisPorts(database, options.profileId),
        dependencyReader: portfolioRuntime.dependencyReader,
        failureSnapshotStore: buildCostBasisFailureSnapshotStore(database),
        holdingsCalculator: portfolioRuntime.holdingsCalculator,
        priceRuntime: portfolioRuntime.priceRuntime,
      })
    );
  } catch (error) {
    return wrapError(error, 'Failed to create portfolio handler');
  }
}
