import { type ProviderEvent } from '@exitbook/blockchain-providers';
import {
  AccountRepository,
  closeDatabase,
  ImportSessionRepository,
  initializeDatabase,
  type KyselyDB,
  RawDataRepository,
  TokenMetadataRepository,
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

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import { createProviderManagerWithStats } from '../shared/provider-manager-factory.js';

import { IngestionMonitor } from './components/ingestion-monitor-components.js';
import { ImportHandler } from './import-handler.js';

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
 * Handles initialization, wiring, and cleanup.
 */
export async function createImportServices(): Promise<ImportServices> {
  const database = await initializeDatabase();
  const repositories = createRepositories(database);

  const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();
  const instrumentation = new InstrumentationCollector();
  providerManager.setInstrumentation(instrumentation);

  const eventBus = new EventBus<IngestionMonitorEvent>({
    onError: (err) => {
      console.error('Event handler error:', err);
    },
  });
  providerManager.setEventBus(eventBus as EventBus<ProviderEvent>);

  const tokenMetadataService = new TokenMetadataService(
    repositories.tokenMetadata,
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
    eventBus as EventBus<IngestionEvent>
  );

  const handler = new ImportHandler(importOrchestrator, transactionProcessService);

  const ingestionMonitor = createEventDrivenController(eventBus, IngestionMonitor, {
    instrumentation,
    providerManager,
  });
  ingestionMonitor.start();

  const cleanup = async () => {
    await ingestionMonitor.stop();
    await cleanupProviderManager();
    await closeDatabase(database);
  };

  return {
    handler,
    ingestionMonitor,
    instrumentation,
    cleanup,
  };
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
    tokenMetadata: new TokenMetadataRepository(database),
  };
}
