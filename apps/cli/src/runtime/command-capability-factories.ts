import type { DataSession } from '@exitbook/data/session';
import { type Result } from '@exitbook/foundation';
import type { AssetReviewProjectionRuntime } from '@exitbook/ingestion/asset-review';
import { BalanceWorkflow } from '@exitbook/ingestion/balance';

import { createCliAssetReviewProjectionRuntime } from '../features/assets/command/asset-review-projection-runtime.js';
import { buildBalanceWorkflowPorts } from '../features/balances/shared/build-balance-workflow-ports.js';

import { adaptResultCleanup, type CommandRuntime } from './command-runtime.js';

export interface CliProjectionProfileScope {
  profileId: number;
  profileKey: string;
}

export interface CliAssetReviewProjectionFactory {
  createForProfile(profile: CliProjectionProfileScope): Result<AssetReviewProjectionRuntime, Error>;
}

export interface CliBalanceWorkflowFactory {
  getOrCreate(): Promise<BalanceWorkflow>;
}

export interface CliCommandCapabilityFactories {
  assetReviewProjectionFactory: CliAssetReviewProjectionFactory;
  balanceWorkflowFactory: CliBalanceWorkflowFactory;
}

export function createCliCommandResourceFactories(
  runtime: CommandRuntime,
  database: DataSession
): CliCommandCapabilityFactories {
  return {
    assetReviewProjectionFactory: {
      createForProfile(profile) {
        return createCliAssetReviewProjectionRuntime(database, runtime.dataDir, {
          priceProviderConfig: runtime.requireAppRuntime().priceProviderConfig,
          profile,
        });
      },
    },
    balanceWorkflowFactory: createCliBalanceWorkflowFactory(runtime, database),
  };
}

function createCliBalanceWorkflowFactory(runtime: CommandRuntime, database: DataSession): CliBalanceWorkflowFactory {
  let workflowPromise: Promise<BalanceWorkflow> | undefined;

  return {
    async getOrCreate() {
      if (!workflowPromise) {
        workflowPromise = (async () => {
          const providerRuntime = await runtime.createManagedBlockchainProviderRuntime({ registerCleanup: false });
          runtime.onCleanup(adaptResultCleanup(providerRuntime.cleanup));
          return new BalanceWorkflow(buildBalanceWorkflowPorts(database), providerRuntime);
        })();
      }

      return await workflowPromise;
    },
  };
}
