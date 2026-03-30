import { PortfolioHandler } from '@exitbook/accounting/portfolio';
import type { Profile } from '@exitbook/core';
import { buildCostBasisFailureSnapshotStore, buildCostBasisPorts } from '@exitbook/data/accounting';
import { err, wrapError, type Result } from '@exitbook/foundation';
import { calculateBalances } from '@exitbook/ingestion/balance';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { readCostBasisDependencyWatermark } from '../../../runtime/cost-basis-dependency-watermark-runtime.js';
import { preparePricedConsumerRuntime } from '../../../runtime/priced-consumer-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';
import { readAssetReviewProjectionSummaries } from '../../shared/asset-review-projection-store.js';
import type { CliOutputFormat } from '../../shared/cli-output-format.js';

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
  try {
    const database = await runtime.database();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return err(profileResult.error);
    }

    const pricedRuntimeResult = await preparePricedConsumerRuntime(runtime, {
      format: options.format,
      profileId: profileResult.value.id,
      profileKey: profileResult.value.profileKey,
      priceConfig: { startDate: new Date(0), endDate: options.asOf },
      target: 'portfolio',
    });
    if (pricedRuntimeResult.isErr()) {
      return err(pricedRuntimeResult.error);
    }

    return operation({
      handler: new PortfolioHandler({
        accountingExclusionPolicy: pricedRuntimeResult.value.accountingExclusionPolicy,
        calculateHoldings: (transactions) => calculateBalances(transactions),
        costBasisStore: buildCostBasisPorts(database, profileResult.value.id),
        failureSnapshotStore: buildCostBasisFailureSnapshotStore(database),
        priceRuntime: pricedRuntimeResult.value.priceRuntime,
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
  } catch (error) {
    return wrapError(error, 'Failed to prepare portfolio command scope');
  }
}
