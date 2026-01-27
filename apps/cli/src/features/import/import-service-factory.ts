import { BlockchainProviderManager, type ProviderEvent } from '@exitbook/blockchain-providers';
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

import type { CliEvent } from '../../ui/dashboard/index.js';
import { DashboardController } from '../../ui/dashboard/index.js';

import { ImportHandler } from './import-handler.js';

/**
 * Service container for import command.
 * Encapsulates all dependencies and cleanup logic.
 */
export interface ImportServices {
  handler: ImportHandler;
  dashboard: DashboardController;
  instrumentation: InstrumentationCollector;
  cleanup: () => Promise<void>;
}

/**
 * Create all services needed for import command.
 * Handles initialization, wiring, and cleanup.
 */
export async function createImportServices(): Promise<ImportServices> {
  // Initialize database
  const database = await initializeDatabase();

  // Create repositories
  const repositories = createRepositories(database);

  // Create provider manager
  const providerManager = new BlockchainProviderManager();

  // Create instrumentation for API call tracking
  const instrumentation = new InstrumentationCollector();
  providerManager.setInstrumentation(instrumentation);

  // Create event bus
  const eventBus = new EventBus<CliEvent>((err) => {
    // Error handler for event bus
    console.error('Event handler error:', err);
  });

  // Wire up provider events
  providerManager.setEventBus(eventBus as EventBus<ProviderEvent>);

  // Create services
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

  // Create handler
  const handler = new ImportHandler(importOrchestrator, transactionProcessService, providerManager);

  // Create dashboard controller and wire to event bus
  const dashboard = new DashboardController(instrumentation, providerManager);
  dashboard.start();

  const unsubscribe = eventBus.subscribe((event) => {
    dashboard.handleEvent(event);
  });

  // Cleanup function
  const cleanup = async () => {
    unsubscribe();
    await dashboard.stop();
    handler.destroy();
    await closeDatabase(database);
  };

  return {
    handler,
    dashboard,
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
