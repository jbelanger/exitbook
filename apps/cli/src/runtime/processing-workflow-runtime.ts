import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { buildProcessingPorts } from '@exitbook/data/ingestion';
import { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import type { EventBus } from '@exitbook/events';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { AdapterRegistry, allExchangeAdapters, createBlockchainAdapters } from '@exitbook/ingestion/adapters';
import type { IngestionEvent } from '@exitbook/ingestion/events';
import { ProcessingWorkflow } from '@exitbook/ingestion/process';

import { createCliAssetReviewProjectionRuntime } from './asset-review-projection-runtime.js';
interface CliProcessingWorkflowRuntime {
  processingWorkflow: ProcessingWorkflow;
}

interface CreateCliProcessingWorkflowRuntimeOptions {
  dataDir: string;
  database: DataSession;
  eventBus: EventBus<IngestionEvent>;
  providerRuntime: IBlockchainProviderRuntime;
}

export async function rebuildCliAssetReviewProjectionsForAccounts(
  database: DataSession,
  dataDir: string,
  accountIds: number[]
): Promise<import('@exitbook/foundation').Result<void, Error>> {
  if (accountIds.length === 0) {
    return ok(undefined);
  }

  const profilesResult = await database.profiles.list();
  if (profilesResult.isErr()) {
    return err(profilesResult.error);
  }

  const profilesById = new Map(profilesResult.value.map((profile) => [profile.id, profile]));
  const scopedProfiles = new Map<number, { profileId: number; profileKey: string }>();

  for (const accountId of [...new Set(accountIds)]) {
    const accountResult = await database.accounts.getById(accountId);
    if (accountResult.isErr()) {
      return err(
        new Error(`Failed to resolve account ${accountId} for asset review rebuild: ${accountResult.error.message}`)
      );
    }

    const profileId = accountResult.value.profileId;
    if (profileId === undefined) {
      return err(new Error(`Profile not set for account ${accountId} during asset review rebuild`));
    }

    const profile = profilesById.get(profileId);
    if (!profile) {
      return err(new Error(`Profile ${String(profileId)} not found for account ${accountId}`));
    }

    scopedProfiles.set(profile.id, {
      profileId: profile.id,
      profileKey: profile.profileKey,
    });
  }

  for (const profile of scopedProfiles.values()) {
    const assetReviewRuntimeResult = createCliAssetReviewProjectionRuntime(database, dataDir, {
      profileId: profile.profileId,
      profileKey: profile.profileKey,
    });
    if (assetReviewRuntimeResult.isErr()) {
      return err(assetReviewRuntimeResult.error);
    }

    const rebuildResult = await assetReviewRuntimeResult.value.rebuild();
    if (rebuildResult.isErr()) {
      return err(
        new Error(`Failed to rebuild asset review for profile ${profile.profileKey}: ${rebuildResult.error.message}`)
      );
    }
  }

  return ok(undefined);
}

export function createCliProcessingWorkflowRuntime(
  options: CreateCliProcessingWorkflowRuntimeOptions
): Result<CliProcessingWorkflowRuntime, Error> {
  try {
    const overrideStore = new OverrideStore(options.dataDir);
    const ports = buildProcessingPorts(options.database, {
      rebuildAssetReviewProjection: (accountIds) =>
        rebuildCliAssetReviewProjectionsForAccounts(options.database, options.dataDir, accountIds),
      overrideStore,
    });
    const processingAdapterRegistry = new AdapterRegistry(
      createBlockchainAdapters({ nearBatchSource: ports.nearBatchSource }),
      allExchangeAdapters
    );

    return ok({
      processingWorkflow: new ProcessingWorkflow(
        ports,
        options.providerRuntime,
        options.eventBus,
        processingAdapterRegistry
      ),
    });
  } catch (error) {
    return wrapError(error, 'Failed to create CLI processing workflow runtime');
  }
}
