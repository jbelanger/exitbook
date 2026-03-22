import { type ProviderEvent } from '@exitbook/blockchain-providers';
import { OverrideStore, type DataContext, buildProcessingPorts } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { type AdapterRegistry, type IngestionEvent, ProcessingWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import { IngestionMonitor } from '../import/view/ingestion-monitor-view-components.jsx';

import { rebuildAssetReviewProjection } from './asset-review-projection-runtime.js';
import type { OpenedBlockchainProviderRuntime } from './blockchain-provider-runtime.js';
import { openBlockchainProviderRuntime } from './blockchain-provider-runtime.js';
import type { CommandContext } from './command-runtime.js';

const logger = getLogger('ingestion-infrastructure');

export type CliEvent = IngestionEvent | ProviderEvent;

interface IngestionInfrastructure {
  processingWorkflow: ProcessingWorkflow;
  providerManager: OpenedBlockchainProviderRuntime;
  instrumentation: InstrumentationCollector;
  eventBus: EventBus<CliEvent>;
  ingestionMonitor: EventDrivenController<CliEvent>;
}

/**
 * Create shared ingestion infrastructure (providerManager +
 * ProcessingWorkflow + IngestionMonitor).
 * Registers cleanup with ctx internally — callers do NOT need ctx.onCleanup.
 */
export async function createIngestionInfrastructure(
  ctx: CommandContext,
  database: DataContext,
  registry: AdapterRegistry
): Promise<IngestionInfrastructure> {
  const instrumentation = new InstrumentationCollector();
  const eventBus = new EventBus<CliEvent>({
    onError: (err) => {
      logger.error({ err }, 'EventBus error');
    },
  });

  const providerRuntime = await openBlockchainProviderRuntime(undefined, {
    dataDir: ctx.dataDir,
    instrumentation,
    eventBus: eventBus as EventBus<ProviderEvent>,
  });

  try {
    const overrideStore = new OverrideStore(ctx.dataDir);
    const ports = buildProcessingPorts(database, {
      rebuildAssetReviewProjection: () => rebuildAssetReviewProjection(database, ctx.dataDir),
      overrideStore,
    });
    const processingWorkflow = new ProcessingWorkflow(
      ports,
      providerRuntime,
      eventBus as EventBus<IngestionEvent>,
      registry
    );

    const ingestionMonitor = createEventDrivenController(eventBus, IngestionMonitor, {
      instrumentation,
      providerManager: providerRuntime,
    });
    await ingestionMonitor.start();

    // LIFO: monitor stops first, then provider manager (which handles its own DB cleanup)
    ctx.onCleanup(async () => {
      let stopError: Error | undefined;

      try {
        await ingestionMonitor.stop();
      } catch (error) {
        stopError = error instanceof Error ? error : new Error(String(error));
      }

      const cleanupResult = await providerRuntime.cleanup();
      if (stopError && cleanupResult.isErr()) {
        throw new AggregateError(
          [stopError, cleanupResult.error],
          'Failed to stop ingestion monitor and cleanup blockchain provider runtime'
        );
      }
      if (stopError) {
        throw stopError;
      }
      if (cleanupResult.isErr()) {
        throw cleanupResult.error;
      }
    });

    return {
      processingWorkflow,
      providerManager: providerRuntime,
      instrumentation,
      eventBus,
      ingestionMonitor,
    };
  } catch (error) {
    const cleanupResult = await providerRuntime.cleanup();
    if (cleanupResult.isErr()) {
      logger.warn({ error: cleanupResult.error }, 'Failed to cleanup blockchain provider runtime on setup failure');
    }
    throw error;
  }
}
