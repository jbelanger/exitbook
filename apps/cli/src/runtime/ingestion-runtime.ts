import { type IBlockchainProviderRuntime, type ProviderEvent } from '@exitbook/blockchain-providers';
import type { DataSession } from '@exitbook/data/session';
import { EventBus } from '@exitbook/events';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { IngestionEvent } from '@exitbook/ingestion/events';
import { ProcessingWorkflow } from '@exitbook/ingestion/process';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';

import { createCliProcessingWorkflowRuntime } from '../features/import/command/import-processing-workflow-runtime.js';
import { IngestionMonitor } from '../features/import/view/ingestion-monitor-view-components.jsx';
import { createEventDrivenController, type EventDrivenController } from '../ui/shared/controllers.js';

import { createCliCommandResourceFactories } from './command-capability-factories.js';
import { adaptResultCleanup, type CommandRuntime } from './command-runtime.js';

const logger = getLogger('ingestion-runtime');

export type CliEvent = IngestionEvent | ProviderEvent;

export interface IngestionRuntime {
  blockchainProviderRuntime: IBlockchainProviderRuntime;
  eventBus: EventBus<CliEvent>;
  ingestionMonitor?: EventDrivenController<CliEvent> | undefined;
  instrumentation: InstrumentationCollector;
  processingWorkflow: ProcessingWorkflow;
}

interface CreateIngestionRuntimeOptions {
  presentation?: 'headless' | 'monitor' | undefined;
  processingTokenMetadataMode?: 'cache-only' | 'read-through' | undefined;
}

interface WithIngestionRuntimeOptions extends CreateIngestionRuntimeOptions {
  onAbortRegistered?: ((runtime: IngestionRuntime) => void) | undefined;
  onAbortReleased?: (() => void) | undefined;
}

export async function createIngestionRuntime(
  ctx: CommandRuntime,
  database: DataSession,
  options: CreateIngestionRuntimeOptions = {}
): Promise<Result<IngestionRuntime, Error>> {
  const instrumentation = new InstrumentationCollector();
  const eventBus = new EventBus<CliEvent>({
    onError: (error) => {
      logger.error({ error }, 'EventBus error');
    },
  });

  let providerRuntime: IBlockchainProviderRuntime | undefined;
  let cleanupBlockchainProviderRuntime: (() => Promise<void>) | undefined;

  try {
    providerRuntime = await ctx.createManagedBlockchainProviderRuntime({
      instrumentation,
      eventBus: eventBus as EventBus<ProviderEvent>,
      registerCleanup: false,
    });
    cleanupBlockchainProviderRuntime = adaptResultCleanup(providerRuntime.cleanup);
    const processingProviderRuntime =
      options.processingTokenMetadataMode === 'cache-only'
        ? createCacheOnlyTokenMetadataRuntime(providerRuntime)
        : providerRuntime;
    const capabilityFactories = createCliCommandResourceFactories(ctx, database);
    const processingWorkflowRuntimeResult = createCliProcessingWorkflowRuntime({
      adapterRegistryFactory: ctx.requireAppRuntime().createAdapterRegistry,
      assetReviewProjectionFactory: capabilityFactories.assetReviewProjectionFactory,
      dataDir: ctx.dataDir,
      database,
      eventBus: eventBus as EventBus<IngestionEvent>,
      providerRuntime: processingProviderRuntime,
    });
    if (processingWorkflowRuntimeResult.isErr()) {
      return err(processingWorkflowRuntimeResult.error);
    }
    const { processingWorkflow } = processingWorkflowRuntimeResult.value;

    let ingestionMonitor: EventDrivenController<CliEvent> | undefined;
    if ((options.presentation ?? 'monitor') === 'monitor') {
      ingestionMonitor = createEventDrivenController(eventBus, IngestionMonitor, {
        instrumentation,
        providerRuntime,
      });
      await ingestionMonitor.start();
    }

    ctx.onCleanup(async () => {
      let stopError: Error | undefined;

      if (ingestionMonitor) {
        try {
          await ingestionMonitor.stop();
        } catch (error) {
          stopError = error instanceof Error ? error : new Error(String(error));
        }
      }

      try {
        await cleanupBlockchainProviderRuntime!();
      } catch (error) {
        const cleanupError = error instanceof Error ? error : new Error(String(error));
        if (stopError) {
          throw new AggregateError(
            [stopError, cleanupError],
            'Failed to stop ingestion monitor and cleanup blockchain provider runtime',
            { cause: error }
          );
        }
        throw cleanupError;
      }

      if (stopError) {
        throw stopError;
      }
    });

    return ok({
      blockchainProviderRuntime: providerRuntime,
      eventBus,
      ingestionMonitor,
      instrumentation,
      processingWorkflow,
    });
  } catch (error) {
    await cleanupBlockchainProviderRuntime?.().catch((cleanupError: unknown) => {
      logger.warn(
        { error: cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)) },
        'Failed to cleanup blockchain provider runtime on setup failure'
      );
    });
    return wrapError(error, 'Failed to create ingestion runtime');
  }
}

export async function withIngestionRuntime<T>(
  ctx: CommandRuntime,
  database: DataSession,
  options: WithIngestionRuntimeOptions,
  operation: (runtime: IngestionRuntime) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  const runtimeResult = await createIngestionRuntime(ctx, database, {
    presentation: options.presentation,
    processingTokenMetadataMode: options.processingTokenMetadataMode,
  });
  if (runtimeResult.isErr()) {
    return err(runtimeResult.error);
  }

  const runtime = runtimeResult.value;
  options.onAbortRegistered?.(runtime);

  try {
    return await operation(runtime);
  } finally {
    options.onAbortReleased?.();
  }
}

function createCacheOnlyTokenMetadataRuntime(runtime: IBlockchainProviderRuntime): IBlockchainProviderRuntime {
  return {
    cleanup() {
      return runtime.cleanup();
    },
    getAddressBalances(blockchain, address, options) {
      return runtime.getAddressBalances(blockchain, address, options);
    },
    getAddressInfo(blockchain, address, options) {
      return runtime.getAddressInfo(blockchain, address, options);
    },
    getAddressTokenBalances(blockchain, address, options) {
      return runtime.getAddressTokenBalances(blockchain, address, options);
    },
    getProviders(blockchain, options) {
      return runtime.getProviders(blockchain, options);
    },
    getTokenMetadata: (blockchain, contractAddresses, options) =>
      runtime.getTokenMetadata(blockchain, contractAddresses, {
        ...options,
        allowProviderFetch: false,
        refreshStale: false,
      }),
    hasAddressTransactions(blockchain, address, options) {
      return runtime.hasAddressTransactions(blockchain, address, options);
    },
    hasRegisteredOperationSupport(blockchain, operation) {
      return runtime.hasRegisteredOperationSupport(blockchain, operation);
    },
    streamAddressTransactions(blockchain, address, options, resumeCursor) {
      return runtime.streamAddressTransactions(blockchain, address, options, resumeCursor);
    },
  };
}
