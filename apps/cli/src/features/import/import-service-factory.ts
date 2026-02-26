import { type ProviderEvent } from '@exitbook/blockchain-providers';
import { createTokenMetadataPersistence, type KyselyDB } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { InstrumentationCollector } from '@exitbook/http';
import {
  type AdapterRegistry,
  ImportOrchestrator,
  type ImportEvent,
  type IngestionEvent,
  TokenMetadataService,
  TransactionProcessingService,
} from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import { getDataDir } from '../shared/data-dir.js';
import { createProviderManagerWithStats } from '../shared/provider-manager-factory.js';

import { IngestionMonitor } from './components/ingestion-monitor-components.js';
import { ImportHandler } from './import-handler.js';

const logger = getLogger('import-service-factory');

type IngestionMonitorEvent = IngestionEvent | ProviderEvent;

/**
 * Service container for import command.
 * Encapsulates all dependencies and cleanup logic.
 */
export interface ImportServices {
  handler: ImportHandler;
  ingestionMonitor: EventDrivenController<IngestionMonitorEvent>;
  instrumentation: InstrumentationCollector;
  cleanup: () => Promise<void>;
}

/**
 * Create all services needed for import command.
 * Caller owns the database lifecycle (via CommandContext).
 */
export async function createImportServices(database: KyselyDB, registry: AdapterRegistry): Promise<ImportServices> {
  const dataDir = getDataDir();
  const tokenMetadataResult = await createTokenMetadataPersistence(dataDir);
  if (tokenMetadataResult.isErr()) {
    logger.error({ error: tokenMetadataResult.error }, 'Failed to create token metadata queries persistence');
    throw tokenMetadataResult.error;
  }

  const { queries: tokenMetadataQueries, cleanup: cleanupTokenMetadata } = tokenMetadataResult.value;

  let providerManagerCleanup: (() => Promise<void>) | undefined;
  try {
    const instrumentation = new InstrumentationCollector();
    const eventBus = new EventBus<IngestionMonitorEvent>({
      onError: (err) => {
        logger.error({ err }, 'EventBus error');
      },
    });

    const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats(undefined, {
      instrumentation,
      eventBus: eventBus as EventBus<ProviderEvent>,
    });
    providerManagerCleanup = cleanupProviderManager;

    const tokenMetadataService = new TokenMetadataService(
      tokenMetadataQueries,
      providerManager,
      eventBus as EventBus<IngestionEvent>
    );

    const importOrchestrator = new ImportOrchestrator(
      database,
      providerManager,
      registry,
      eventBus as EventBus<ImportEvent>
    );

    const transactionProcessService = new TransactionProcessingService(
      database,
      providerManager,
      tokenMetadataService,
      eventBus as EventBus<IngestionEvent>,
      registry
    );

    const handler = new ImportHandler(importOrchestrator, transactionProcessService, registry);

    const ingestionMonitor = createEventDrivenController(eventBus, IngestionMonitor, {
      instrumentation,
      providerManager,
    });
    ingestionMonitor.start();

    const cleanup = async () => {
      try {
        await ingestionMonitor.stop();
      } finally {
        try {
          await cleanupProviderManager();
        } finally {
          await cleanupTokenMetadata();
        }
      }
    };

    return {
      handler,
      ingestionMonitor,
      instrumentation,
      cleanup,
    };
  } catch (error) {
    if (providerManagerCleanup) {
      try {
        await providerManagerCleanup();
      } catch (cleanupError) {
        logger.warn({ cleanupError }, 'Failed to cleanup provider manager after service initialization failure');
      }
    }

    try {
      await cleanupTokenMetadata();
    } catch (cleanupError) {
      logger.warn({ cleanupError }, 'Failed to cleanup token metadata database after service initialization failure');
    }

    throw error;
  }
}
