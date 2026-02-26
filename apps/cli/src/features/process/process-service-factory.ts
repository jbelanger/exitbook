import { type ProviderEvent } from '@exitbook/blockchain-providers';
import {
  createRawDataQueries,
  createTokenMetadataPersistence,
  // eslint-disable-next-line no-restricted-imports -- ok here since this is the CLI boundary
  type KyselyDB,
} from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { InstrumentationCollector } from '@exitbook/http';
import {
  type AdapterRegistry,
  ClearService,
  type IngestionEvent,
  TokenMetadataService,
  TransactionProcessingService,
} from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import { IngestionMonitor } from '../import/components/ingestion-monitor-components.js';
import { getDataDir } from '../shared/data-dir.js';
import { createProviderManagerWithStats } from '../shared/provider-manager-factory.js';

import type { ProcessHandlerParams, BatchProcessSummary } from './process-handler.js';
import { executeReprocess } from './process-handler.js';

const logger = getLogger('process-service-factory');

type CliEvent = IngestionEvent | ProviderEvent;

/**
 * Service container for process command.
 * Encapsulates all dependencies and cleanup logic.
 */
export interface ProcessServices {
  execute: (params: ProcessHandlerParams) => Promise<Result<BatchProcessSummary, Error>>;
  ingestionMonitor: EventDrivenController<CliEvent>;
  instrumentation: InstrumentationCollector;
  cleanup: () => Promise<void>;
}

/**
 * Create all services needed for process command.
 * Caller owns the database lifecycle (via CommandContext).
 */
export async function createProcessServices(database: KyselyDB, registry: AdapterRegistry): Promise<ProcessServices> {
  const rawData = createRawDataQueries(database);

  const dataDir = getDataDir();
  const tokenMetadataResult = await createTokenMetadataPersistence(dataDir);
  if (tokenMetadataResult.isErr()) {
    logger.error({ error: tokenMetadataResult.error }, 'Failed to create token metadata queries');
    throw tokenMetadataResult.error;
  }

  const { queries: tokenMetadata, cleanup: cleanupTokenMetadata } = tokenMetadataResult.value;

  let providerManagerCleanup: (() => Promise<void>) | undefined;
  try {
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
    providerManagerCleanup = cleanupProviderManager;

    const tokenMetadataService = new TokenMetadataService(
      tokenMetadata,
      providerManager,
      eventBus as EventBus<IngestionEvent>
    );

    const transactionProcessService = new TransactionProcessingService(
      database,
      providerManager,
      tokenMetadataService,
      eventBus as EventBus<IngestionEvent>,
      registry
    );

    const clearService = new ClearService(database, eventBus as EventBus<IngestionEvent>);

    const ingestionMonitor = createEventDrivenController(eventBus, IngestionMonitor, {
      instrumentation,
      providerManager,
    });
    await ingestionMonitor.start();

    // Create execute function with dependencies bound
    const execute = (params: ProcessHandlerParams) =>
      executeReprocess(params, {
        transactionProcessService,
        clearService,
        rawDataQueries: rawData,
      });

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
      execute,
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
