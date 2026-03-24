import { buildProcessingPorts } from '@exitbook/data/ingestion';
import { OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import type { EventBus } from '@exitbook/events';
import { ProcessingWorkflow, type AdapterRegistry, type IngestionEvent } from '@exitbook/ingestion';

import { createCliAssetReviewProjectionRuntime } from '../features/shared/asset-review-projection-runtime.js';
import type { OpenedCliBlockchainProviderRuntime } from '../features/shared/blockchain-provider-runtime.js';

export interface CliProcessingWorkflowRuntime {
  processingWorkflow: ProcessingWorkflow;
}

export interface CreateCliProcessingWorkflowRuntimeOptions {
  adapterRegistry: AdapterRegistry;
  dataDir: string;
  database: DataSession;
  eventBus: EventBus<IngestionEvent>;
  providerRuntime: OpenedCliBlockchainProviderRuntime;
}

export function createCliProcessingWorkflowRuntime(
  options: CreateCliProcessingWorkflowRuntimeOptions
): CliProcessingWorkflowRuntime {
  const overrideStore = new OverrideStore(options.dataDir);
  const ports = buildProcessingPorts(options.database, {
    rebuildAssetReviewProjection: () =>
      createCliAssetReviewProjectionRuntime(options.database, options.dataDir).rebuild(),
    overrideStore,
  });

  return {
    processingWorkflow: new ProcessingWorkflow(
      ports,
      options.providerRuntime,
      options.eventBus,
      options.adapterRegistry
    ),
  };
}
