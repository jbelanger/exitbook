import { type ProviderEvent } from '@exitbook/blockchain-providers';
import type { DataSession } from '@exitbook/data/session';
import { EventBus } from '@exitbook/events';
import { type IngestionEvent, ProcessingWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { InstrumentationCollector } from '@exitbook/observability';

import { IngestionMonitor } from '../features/import/view/ingestion-monitor-view-components.jsx';
import type { OpenedCliBlockchainProviderRuntime } from '../features/shared/blockchain-provider-runtime.js';
import { createEventDrivenController, type EventDrivenController } from '../ui/shared/index.js';

import { adaptResultCleanup, type CommandScope } from './command-scope.js';
import { createCliProcessingWorkflowRuntime } from './processing-workflow-runtime.js';

const logger = getLogger('ingestion-runtime');

export type CliEvent = IngestionEvent | ProviderEvent;

export interface IngestionRuntime {
  blockchainProviderRuntime: OpenedCliBlockchainProviderRuntime;
  eventBus: EventBus<CliEvent>;
  ingestionMonitor?: EventDrivenController<CliEvent> | undefined;
  instrumentation: InstrumentationCollector;
  processingWorkflow: ProcessingWorkflow;
}

export interface CreateIngestionRuntimeOptions {
  presentation?: 'headless' | 'monitor' | undefined;
}

export async function createIngestionRuntime(
  ctx: CommandScope,
  database: DataSession,
  options: CreateIngestionRuntimeOptions = {}
): Promise<IngestionRuntime> {
  const appRuntime = ctx.requireAppRuntime();
  const instrumentation = new InstrumentationCollector();
  const eventBus = new EventBus<CliEvent>({
    onError: (error) => {
      logger.error({ error }, 'EventBus error');
    },
  });

  const providerRuntimeResult = await ctx.openBlockchainProviderRuntime({
    instrumentation,
    eventBus: eventBus as EventBus<ProviderEvent>,
    registerCleanup: false,
  });
  if (providerRuntimeResult.isErr()) {
    throw providerRuntimeResult.error;
  }
  const providerRuntime = providerRuntimeResult.value;
  const cleanupBlockchainProviderRuntime = adaptResultCleanup(providerRuntime.cleanup);

  try {
    const { processingWorkflow } = createCliProcessingWorkflowRuntime({
      adapterRegistry: appRuntime.adapterRegistry,
      dataDir: ctx.dataDir,
      database,
      eventBus: eventBus as EventBus<IngestionEvent>,
      providerRuntime,
    });

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
        await cleanupBlockchainProviderRuntime();
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

    return {
      blockchainProviderRuntime: providerRuntime,
      eventBus,
      ingestionMonitor,
      instrumentation,
      processingWorkflow,
    };
  } catch (error) {
    await cleanupBlockchainProviderRuntime().catch((cleanupError: unknown) => {
      logger.warn(
        { error: cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)) },
        'Failed to cleanup blockchain provider runtime on setup failure'
      );
    });
    throw error;
  }
}
