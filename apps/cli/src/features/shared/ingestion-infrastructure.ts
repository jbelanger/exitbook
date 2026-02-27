import { type ProviderEvent } from '@exitbook/blockchain-providers';
// eslint-disable-next-line no-restricted-imports -- ok here since this is the CLI boundary
import { createTokenMetadataPersistence, type KyselyDB } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import { InstrumentationCollector } from '@exitbook/http';
import {
  type AdapterRegistry,
  type IngestionEvent,
  TokenMetadataService,
  TransactionProcessingService,
} from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

import { createEventDrivenController, type EventDrivenController } from '../../ui/shared/index.js';
import { IngestionMonitor } from '../import/components/ingestion-monitor-view-components.js';

import type { CommandContext } from './command-runtime.js';
import { getDataDir } from './data-dir.js';
import { createProviderManagerWithStats, type ProviderManagerWithStats } from './provider-manager-factory.js';

const logger = getLogger('ingestion-infrastructure');

export type CliEvent = IngestionEvent | ProviderEvent;

export interface IngestionInfrastructure {
  tokenMetadataService: TokenMetadataService;
  transactionProcessService: TransactionProcessingService;
  providerManager: ProviderManagerWithStats['providerManager'];
  instrumentation: InstrumentationCollector;
  eventBus: EventBus<CliEvent>;
  ingestionMonitor: EventDrivenController<CliEvent>;
}

/**
 * Create shared ingestion infrastructure (tokenMetadata + providerManager +
 * TokenMetadataService + TransactionProcessingService + IngestionMonitor).
 * Registers cleanup with ctx internally — callers do NOT need ctx.onCleanup.
 */
export async function createIngestionInfrastructure(
  ctx: CommandContext,
  database: KyselyDB,
  registry: AdapterRegistry
): Promise<IngestionInfrastructure> {
  const dataDir = getDataDir();
  const tokenMetadataResult = await createTokenMetadataPersistence(dataDir);
  if (tokenMetadataResult.isErr()) {
    logger.error({ error: tokenMetadataResult.error }, 'Failed to create token metadata persistence');
    throw tokenMetadataResult.error;
  }
  const { queries: tokenMetadataQueries, cleanup: cleanupTokenMetadata } = tokenMetadataResult.value;

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
      tokenMetadataQueries,
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

    const ingestionMonitor = createEventDrivenController(eventBus, IngestionMonitor, {
      instrumentation,
      providerManager,
    });
    await ingestionMonitor.start();

    // LIFO: monitor stops first, then provider, then tokenMetadata
    ctx.onCleanup(async () => {
      try {
        await ingestionMonitor.stop();
      } finally {
        try {
          await cleanupProviderManager();
        } finally {
          await cleanupTokenMetadata();
        }
      }
    });

    return {
      tokenMetadataService,
      transactionProcessService,
      providerManager,
      instrumentation,
      eventBus,
      ingestionMonitor,
    };
  } catch (error) {
    if (providerManagerCleanup) {
      await providerManagerCleanup().catch((e) =>
        logger.warn({ e }, 'Failed to cleanup providerManager on setup failure')
      );
    }
    await cleanupTokenMetadata().catch((e) => logger.warn({ e }, 'Failed to cleanup tokenMetadata on setup failure'));
    throw error;
  }
}
