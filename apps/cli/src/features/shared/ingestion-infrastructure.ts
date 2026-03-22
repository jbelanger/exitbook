import { type ProviderEvent } from '@exitbook/blockchain-providers';
import { OverrideStore, type DataContext, buildProcessingPorts } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { type AdapterRegistry, type IngestionEvent, ProcessingWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import { IngestionMonitor } from '../import/view/ingestion-monitor-view-components.jsx';

import { rebuildAssetReviewProjection } from './asset-review-projection-runtime.js';
import type { OpenedCliBlockchainProviderRuntime } from './blockchain-provider-runtime.js';
import { openCliBlockchainProviderRuntime } from './blockchain-provider-runtime.js';
import { adaptResultCleanup, type CommandContext } from './command-runtime.js';

const logger = getLogger('ingestion-infrastructure');

export type CliEvent = IngestionEvent | ProviderEvent;

interface IngestionInfrastructure {
  processingWorkflow: ProcessingWorkflow;
  blockchainProviderRuntime: OpenedCliBlockchainProviderRuntime;
  instrumentation: InstrumentationCollector;
  eventBus: EventBus<CliEvent>;
  ingestionMonitor: EventDrivenController<CliEvent>;
}

/**
 * Create shared ingestion infrastructure (blockchain provider runtime +
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

  const providerRuntimeResult = await openCliBlockchainProviderRuntime({
    dataDir: ctx.dataDir,
    instrumentation,
    eventBus: eventBus as EventBus<ProviderEvent>,
  });
  if (providerRuntimeResult.isErr()) {
    throw providerRuntimeResult.error;
  }
  const providerRuntime = providerRuntimeResult.value;
  const cleanupBlockchainProviderRuntime = adaptResultCleanup(providerRuntime.cleanup);

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
      providerRuntime,
    });
    await ingestionMonitor.start();

    // LIFO: monitor stops first, then the blockchain provider runtime.
    ctx.onCleanup(async () => {
      let stopError: Error | undefined;

      try {
        await ingestionMonitor.stop();
      } catch (error) {
        stopError = error instanceof Error ? error : new Error(String(error));
      }

      try {
        await cleanupBlockchainProviderRuntime();
      } catch (error) {
        const cleanupError = error instanceof Error ? error : new Error(String(error));
        if (stopError) {
          throw new AggregateError(
            [stopError, cleanupError],
            'Failed to stop ingestion monitor and cleanup blockchain provider runtime',
            { cause: error }
          );
        }
        throw cleanupError;
      }

      if (stopError) {
        throw stopError;
      }
    });

    return {
      processingWorkflow,
      blockchainProviderRuntime: providerRuntime,
      instrumentation,
      eventBus,
      ingestionMonitor,
    };
  } catch (error) {
    await cleanupBlockchainProviderRuntime().catch((cleanupError: unknown) => {
      logger.warn(
        { error: cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)) },
        'Failed to cleanup blockchain provider runtime on setup failure'
      );
    });
    throw error;
  }
}
