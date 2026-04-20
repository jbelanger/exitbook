import { PortfolioHandler } from '@exitbook/accounting/portfolio';
import type { Profile } from '@exitbook/core';
import { buildCostBasisPorts } from '@exitbook/data/accounting';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';

import type { CliOutputFormat } from '../../../cli/options.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { readCostBasisDependencyWatermark } from '../../../runtime/cost-basis-dependency-watermark-runtime.js';
import { preparePricedConsumerRuntime } from '../../../runtime/priced-consumer-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';

export interface PortfolioCommandScope {
  handler: PortfolioHandler;
  profile: Profile;
}

export async function withPortfolioCommandScope<T>(
  runtime: CommandRuntime,
  options: {
    asOf: Date;
    format: CliOutputFormat;
  },
  operation: (scope: PortfolioCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const pricedRuntimeResult = await preparePricedConsumerRuntime(runtime, {
      format: options.format,
      profileId: profileResult.value.id,
      profileKey: profileResult.value.profileKey,
      priceConfig: { startDate: new Date(0), endDate: options.asOf },
      target: 'portfolio',
    });
    if (pricedRuntimeResult.isErr()) {
      return yield* err(pricedRuntimeResult.error);
    }

    const value = yield* await operation({
      handler: new PortfolioHandler({
        accountingExclusionPolicy: pricedRuntimeResult.value.accountingExclusionPolicy,
        costBasisStore: buildCostBasisPorts(database, profileResult.value.id),
        failureSnapshotStore: database.costBasisFailureSnapshots,
        priceRuntime: pricedRuntimeResult.value.priceRuntime,
        profileId: profileResult.value.id,
        readAssetReviewSummaries: () => readAssetReviewProjectionSummaries(database, profileResult.value.id),
        readDependencyWatermark: () =>
          readCostBasisDependencyWatermark(
            database,
            runtime.dataDir,
            pricedRuntimeResult.value.accountingExclusionPolicy,
            profileResult.value.id
          ),
      }),
      profile: profileResult.value,
    });
    return value;
  }, 'Failed to prepare portfolio command scope');
}
