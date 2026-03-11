import { type ProviderEvent } from '@exitbook/blockchain-providers';
import { type DataContext, buildProcessingPorts } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { type AdapterRegistry, type IngestionEvent, ProcessingWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import { IngestionMonitor } from '../import/view/ingestion-monitor-view-components.jsx';

import { rebuildAssetReviewProjection } from './asset-review-projection-runtime.js';
import type { CommandContext } from './command-runtime.js';
import { createProviderManagerWithStats, type ProviderManagerWithStats } from './provider-manager-factory.js';

const logger = getLogger('ingestion-infrastructure');

export type CliEvent = IngestionEvent | ProviderEvent;

export interface IngestionInfrastructure {
  processingWorkflow: ProcessingWorkflow;
  providerManager: ProviderManagerWithStats['providerManager'];
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

  const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats(undefined, {
    dataDir: ctx.dataDir,
    instrumentation,
    eventBus: eventBus as EventBus<ProviderEvent>,
  });

  try {
    const ports = buildProcessingPorts(database, {
      rebuildAssetReviewProjection: () => rebuildAssetReviewProjection(database, ctx.dataDir),
    });
    const processingWorkflow = new ProcessingWorkflow(
      ports,
      providerManager,
      eventBus as EventBus<IngestionEvent>,
      registry
    );

    const ingestionMonitor = createEventDrivenController(eventBus, IngestionMonitor, {
      instrumentation,
      providerManager,
    });
    await ingestionMonitor.start();

    // LIFO: monitor stops first, then provider manager (which handles its own DB cleanup)
    ctx.onCleanup(async () => {
      try {
        await ingestionMonitor.stop();
      } finally {
        await cleanupProviderManager();
      }
    });

    return {
      processingWorkflow,
      providerManager,
      instrumentation,
      eventBus,
      ingestionMonitor,
    };
  } catch (error) {
    await cleanupProviderManager().catch((e) =>
      logger.warn({ e }, 'Failed to cleanup providerManager on setup failure')
    );
    throw error;
  }
}
