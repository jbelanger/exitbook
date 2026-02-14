import { type ProviderEvent } from '@exitbook/blockchain-providers';
import {
  AccountRepository,
  createTokenMetadataPersistence,
  ImportSessionRepository,
  type KyselyDB,
  RawDataRepository,
  TransactionRepository,
  UserRepository,
} from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { InstrumentationCollector } from '@exitbook/http';
import {
  ImportOrchestrator,
  type ImportEvent,
  type IngestionEvent,
  TokenMetadataService,
  TransactionProcessService,
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
export async function createImportServices(database: KyselyDB): Promise<ImportServices> {
  const repositories = createRepositories(database);

  const dataDir = getDataDir();
  const tokenMetadataResult = await createTokenMetadataPersistence(dataDir);
  if (tokenMetadataResult.isErr()) {
    logger.error({ error: tokenMetadataResult.error }, 'Failed to create token metadata repository');
    throw tokenMetadataResult.error;
  }

  const { repository: tokenMetadataRepository, cleanup: cleanupTokenMetadata } = tokenMetadataResult.value;

  let providerManagerCleanup: (() => Promise<void>) | undefined;
  try {
    const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();
    providerManagerCleanup = cleanupProviderManager;
    const instrumentation = new InstrumentationCollector();
    providerManager.setInstrumentation(instrumentation);

    const eventBus = new EventBus<IngestionMonitorEvent>({
      onError: (err) => {
        logger.error({ err }, 'EventBus error');
      },
    });
    providerManager.setEventBus(eventBus as EventBus<ProviderEvent>);

    const tokenMetadataService = new TokenMetadataService(
      tokenMetadataRepository,
      providerManager,
      eventBus as EventBus<IngestionEvent>
    );

    const importOrchestrator = new ImportOrchestrator(
      repositories.user,
      repositories.account,
      repositories.rawData,
      repositories.importSession,
      providerManager,
      eventBus as EventBus<ImportEvent>
    );

    const transactionProcessService = new TransactionProcessService(
      repositories.rawData,
      repositories.account,
      repositories.transaction,
      providerManager,
      tokenMetadataService,
      repositories.importSession,
      eventBus as EventBus<IngestionEvent>,
      database
    );

    const handler = new ImportHandler(importOrchestrator, transactionProcessService);

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

/**
 * Create all repositories from database.
 */
function createRepositories(database: KyselyDB) {
  return {
    user: new UserRepository(database),
    account: new AccountRepository(database),
    transaction: new TransactionRepository(database),
    rawData: new RawDataRepository(database),
    importSession: new ImportSessionRepository(database),
  };
}
