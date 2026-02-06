import { CostBasisRepository, LotTransferRepository, TransactionLinkRepository } from '@exitbook/accounting';
import { BlockchainProviderManager, type ProviderEvent } from '@exitbook/blockchain-providers';
import {
  AccountRepository,
  closeDatabase,
  ImportSessionRepository,
  initializeDatabase,
  RawDataRepository,
  TokenMetadataRepository,
  TransactionRepository,
  UserRepository,
} from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { InstrumentationCollector } from '@exitbook/http';
import {
  ClearService,
  type IngestionEvent,
  TokenMetadataService,
  TransactionProcessService,
} from '@exitbook/ingestion';
import type { Result } from 'neverthrow';

import { DashboardController } from '../../ui/dashboard/index.js';

import type { ProcessHandlerParams, ProcessResult } from './process-handler.js';
import { executeReprocess } from './process-handler.js';

type CliEvent = IngestionEvent | ProviderEvent;

/**
 * Service container for process command.
 * Encapsulates all dependencies and cleanup logic.
 */
export interface ProcessServices {
  execute: (params: ProcessHandlerParams) => Promise<Result<ProcessResult, Error>>;
  dashboard: DashboardController;
  instrumentation: InstrumentationCollector;
  cleanup: () => Promise<void>;
}

/**
 * Create all services needed for process command.
 * Handles initialization, wiring, and cleanup.
 */
export async function createProcessServices(): Promise<ProcessServices> {
  const database = await initializeDatabase();

  // Create repositories
  const user = new UserRepository(database);
  const account = new AccountRepository(database);
  const transaction = new TransactionRepository(database);
  const rawData = new RawDataRepository(database);
  const importSession = new ImportSessionRepository(database);
  const tokenMetadata = new TokenMetadataRepository(database);
  const transactionLink = new TransactionLinkRepository(database);
  const costBasis = new CostBasisRepository(database);
  const lotTransfer = new LotTransferRepository(database);

  const providerManager = new BlockchainProviderManager();
  const instrumentation = new InstrumentationCollector();
  providerManager.setInstrumentation(instrumentation);

  const eventBus = new EventBus<CliEvent>((err) => {
    console.error('Event handler error:', err);
  });
  providerManager.setEventBus(eventBus as EventBus<ProviderEvent>);

  const tokenMetadataService = new TokenMetadataService(
    tokenMetadata,
    providerManager,
    eventBus as EventBus<IngestionEvent>
  );

  const transactionProcessService = new TransactionProcessService(
    rawData,
    account,
    transaction,
    providerManager,
    tokenMetadataService,
    importSession,
    eventBus as EventBus<IngestionEvent>
  );

  const clearService = new ClearService(
    user,
    account,
    transaction,
    transactionLink,
    costBasis,
    lotTransfer,
    rawData,
    importSession
  );

  const dashboard = new DashboardController(eventBus as EventBus<IngestionEvent>, instrumentation, providerManager);
  dashboard.start();

  // Create execute function with dependencies bound
  const execute = (params: ProcessHandlerParams) =>
    executeReprocess(params, {
      transactionProcessService,
      clearService,
      rawDataRepository: rawData,
    });

  const cleanup = async () => {
    await dashboard.stop();
    providerManager.destroy();
    await closeDatabase(database);
  };

  return {
    execute,
    dashboard,
    instrumentation,
    cleanup,
  };
}
