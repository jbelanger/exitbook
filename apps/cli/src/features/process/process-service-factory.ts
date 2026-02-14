import { TransactionLinkRepository } from '@exitbook/accounting';
import { type ProviderEvent } from '@exitbook/blockchain-providers';
import {
  AccountRepository,
  ImportSessionRepository,
  // eslint-disable-next-line no-restricted-imports -- ok here since this is the CLI boundary
  type KyselyDB,
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
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import { IngestionMonitor } from '../import/components/ingestion-monitor-components.js';
import { createProviderManagerWithStats } from '../shared/provider-manager-factory.js';

import type { ProcessHandlerParams, ProcessResult } from './process-handler.js';
import { executeReprocess } from './process-handler.js';

const logger = getLogger('process-service-factory');

type CliEvent = IngestionEvent | ProviderEvent;

/**
 * Service container for process command.
 * Encapsulates all dependencies and cleanup logic.
 */
export interface ProcessServices {
  execute: (params: ProcessHandlerParams) => Promise<Result<ProcessResult, Error>>;
  ingestionMonitor: EventDrivenController<CliEvent>;
  instrumentation: InstrumentationCollector;
  cleanup: () => Promise<void>;
}

/**
 * Create all services needed for process command.
 * Caller owns the database lifecycle (via CommandContext).
 */
export async function createProcessServices(database: KyselyDB): Promise<ProcessServices> {
  // Create repositories
  const user = new UserRepository(database);
  const account = new AccountRepository(database);
  const transaction = new TransactionRepository(database);
  const rawData = new RawDataRepository(database);
  const importSession = new ImportSessionRepository(database);
  const tokenMetadata = new TokenMetadataRepository(database);
  const transactionLink = new TransactionLinkRepository(database);

  const { providerManager, cleanup: cleanupProviderManager } = await createProviderManagerWithStats();
  const instrumentation = new InstrumentationCollector();
  providerManager.setInstrumentation(instrumentation);

  const eventBus = new EventBus<CliEvent>({
    onError: (err) => {
      logger.error({ err }, 'EventBus error');
    },
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
    eventBus as EventBus<IngestionEvent>,
    database
  );

  const clearService = new ClearService(
    user,
    account,
    transaction,
    transactionLink,
    rawData,
    importSession,
    eventBus as EventBus<IngestionEvent>
  );

  const ingestionMonitor = createEventDrivenController(eventBus, IngestionMonitor, {
    instrumentation,
    providerManager,
  });
  ingestionMonitor.start();

  // Create execute function with dependencies bound
  const execute = (params: ProcessHandlerParams) =>
    executeReprocess(params, {
      transactionProcessService,
      clearService,
      rawDataRepository: rawData,
    });

  const cleanup = async () => {
    await ingestionMonitor.stop();
    await cleanupProviderManager();
  };

  return {
    execute,
    ingestionMonitor,
    instrumentation,
    cleanup,
  };
}
