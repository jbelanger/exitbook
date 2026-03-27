import { buildProcessingPorts } from '@exitbook/data/ingestion';
import { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import type { EventBus } from '@exitbook/events';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import { ProcessingWorkflow, type AdapterRegistry, type IngestionEvent } from '@exitbook/ingestion';

import { createCliAssetReviewProjectionRuntime } from '../features/shared/asset-review-projection-runtime.js';
import type { OpenedCliBlockchainProviderRuntime } from '../features/shared/blockchain-provider-runtime.js';

interface CliProcessingWorkflowRuntime {
  processingWorkflow: ProcessingWorkflow;
}

interface CreateCliProcessingWorkflowRuntimeOptions {
  adapterRegistry: AdapterRegistry;
  dataDir: string;
  database: DataSession;
  eventBus: EventBus<IngestionEvent>;
  providerRuntime: OpenedCliBlockchainProviderRuntime;
}

async function rebuildAllCliAssetReviewProjections(
  database: DataSession,
  dataDir: string
): Promise<import('@exitbook/foundation').Result<void, Error>> {
  const profilesResult = await database.profiles.list();
  if (profilesResult.isErr()) {
    return err(profilesResult.error);
  }

  for (const profile of profilesResult.value) {
    const assetReviewRuntimeResult = createCliAssetReviewProjectionRuntime(database, dataDir, {
      profileId: profile.id,
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
      rebuildAssetReviewProjection: () => rebuildAllCliAssetReviewProjections(options.database, options.dataDir),
      overrideStore,
    });

    return ok({
      processingWorkflow: new ProcessingWorkflow(
        ports,
        options.providerRuntime,
        options.eventBus,
        options.adapterRegistry
      ),
    });
  } catch (error) {
    return wrapError(error, 'Failed to create CLI processing workflow runtime');
  }
}
