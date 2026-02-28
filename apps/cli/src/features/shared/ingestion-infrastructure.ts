import { type ProviderEvent } from '@exitbook/blockchain-providers';
import { type DataContext } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { type AdapterRegistry, type IngestionEvent, RawDataProcessingService } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import { IngestionMonitor } from '../import/components/ingestion-monitor-view-components.js';

import type { CommandContext } from './command-runtime.js';
import { createProviderManagerWithStats, type ProviderManagerWithStats } from './provider-manager-factory.js';

const logger = getLogger('ingestion-infrastructure');

export type CliEvent = IngestionEvent | ProviderEvent;

export interface IngestionInfrastructure {
  rawDataProcessingService: RawDataProcessingService;
  providerManager: ProviderManagerWithStats['providerManager'];
  instrumentation: InstrumentationCollector;
  eventBus: EventBus<CliEvent>;
  ingestionMonitor: EventDrivenController<CliEvent>;
}

/**
 * Create shared ingestion infrastructure (providerManager +
 * RawDataProcessingService + IngestionMonitor).
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
    instrumentation,
    eventBus: eventBus as EventBus<ProviderEvent>,
  });

  try {
    const rawDataProcessingService = new RawDataProcessingService(
      database,
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
      rawDataProcessingService,
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
