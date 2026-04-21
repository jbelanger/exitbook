import type { Profile } from '@exitbook/core';
import { err, resultTryAsync, type Result } from '@exitbook/foundation';

import type { CliOutputFormat } from '../../../cli/options.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { readCostBasisDependencyWatermark } from '../../../runtime/cost-basis-dependency-watermark-runtime.js';
import { preparePricedConsumerRuntime } from '../../../runtime/priced-consumer-runtime.js';
import { resolveCommandProfile } from '../../profiles/profile-resolution.js';

import { CostBasisHandler, type ValidatedCostBasisConfig } from './cost-basis-handler.js';

export interface CostBasisCommandScope {
  handler: CostBasisHandler;
  profile: Profile;
}

export async function withCostBasisCommandScope<T>(
  runtime: CommandRuntime,
  options: {
    format: CliOutputFormat;
    params: ValidatedCostBasisConfig;
  },
  operation: (scope: CostBasisCommandScope) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  return resultTryAsync<T>(async function* () {
    const database = await runtime.openDatabaseSession();
    const profileResult = await resolveCommandProfile(runtime, database);
    if (profileResult.isErr()) {
      return yield* err(profileResult.error);
    }

    const pricedRuntimeResult = await preparePricedConsumerRuntime(runtime, {
      format: options.format,
      priceConfig: {
        startDate: options.params.startDate,
        endDate: options.params.endDate,
      },
      profileId: profileResult.value.id,
      profileKey: profileResult.value.profileKey,
      target: 'cost-basis',
    });
    if (pricedRuntimeResult.isErr()) {
      return yield* err(pricedRuntimeResult.error);
    }

    const value = yield* await operation({
      handler: new CostBasisHandler(
        database,
        profileResult.value.id,
        pricedRuntimeResult.value.accountingExclusionPolicy,
        pricedRuntimeResult.value.priceRuntime,
        () =>
          readCostBasisDependencyWatermark(
            database,
            runtime.dataDir,
            pricedRuntimeResult.value.accountingExclusionPolicy,
            profileResult.value.id
          )
      ),
      profile: profileResult.value,
    });
    return value;
  }, 'Failed to prepare cost basis command scope');
}
