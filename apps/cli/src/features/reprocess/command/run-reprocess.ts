import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultTryAsync, type Result } from '@exitbook/foundation';
import type { ProcessingWorkflow } from '@exitbook/ingestion/process';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/observability';

import type { CliOutputFormat } from '../../../cli/options.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { type CliEvent, withIngestionRuntime } from '../../../runtime/ingestion-runtime.js';
import { resetProjections } from '../../../runtime/projection-reset.js';
import type { EventDrivenController } from '../../../ui/shared/controllers.js';

export interface ReprocessResultWithMetrics {
  processed: number;
  errors: string[];
  failed: number;
  runStats: MetricsSummary;
}

interface ReprocessParams {
  /** Reprocess accounts within a specific profile scope */
  profileId?: number | undefined;
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

const logger = getLogger('ReprocessRunner');

export interface ReprocessExecutionRuntime {
  database: DataSession;
  processingWorkflow: ProcessingWorkflow;
  ingestionMonitor?: EventDrivenController<CliEvent> | undefined;
  instrumentation: InstrumentationCollector;
}

function createReprocessExecutionRuntime(
  database: DataSession,
  infra: {
    ingestionMonitor?: EventDrivenController<CliEvent> | undefined;
    instrumentation: InstrumentationCollector;
    processingWorkflow: ProcessingWorkflow;
  }
): ReprocessExecutionRuntime {
  return {
    database,
    processingWorkflow: infra.processingWorkflow,
    ingestionMonitor: infra.ingestionMonitor,
    instrumentation: infra.instrumentation,
  };
}

async function stopReprocessMonitor(runtime: ReprocessExecutionRuntime): Promise<void> {
  await runtime.ingestionMonitor?.stop();
}

async function failAndStopMonitor(runtime: ReprocessExecutionRuntime, errorMessage: string): Promise<void> {
  runtime.ingestionMonitor?.fail(errorMessage);
  await stopReprocessMonitor(runtime);
}

export async function executeReprocessWithRuntime(
  runtime: ReprocessExecutionRuntime,
  params: ReprocessParams
): Promise<Result<ReprocessResultWithMetrics, Error>> {
  const planResult = await runtime.processingWorkflow.prepareReprocess(params);
  if (planResult.isErr()) {
    await failAndStopMonitor(runtime, planResult.error.message);
    return err(planResult.error);
  }

  const plan = planResult.value;
  if (!plan) {
    await stopReprocessMonitor(runtime);
    return ok({ processed: 0, errors: [], failed: 0, runStats: runtime.instrumentation.getSummary() });
  }

  const resetResult = await resetProjections(runtime.database, 'processed-transactions', plan.accountIds);
  if (resetResult.isErr()) {
    await failAndStopMonitor(runtime, resetResult.error.message);
    return err(resetResult.error);
  }
  logger.info('Reset projections for reprocess');

  const result = await runtime.processingWorkflow.processImportedSessions(plan.accountIds);
  if (result.isErr()) {
    await failAndStopMonitor(runtime, result.error.message);
    return err(result.error);
  }

  if (result.value.failed > 0) {
    const firstErrors = result.value.errors.slice(0, 5).join('; ');
    const errorMessage =
      `Reprocess failed: ${result.value.failed} account(s) failed during processing. ` +
      (firstErrors.length > 0 ? `First errors: ${firstErrors}` : 'See logs for details.');

    await failAndStopMonitor(runtime, errorMessage);
    return err(new Error(errorMessage));
  }

  await stopReprocessMonitor(runtime);
  return ok({
    processed: result.value.processed,
    errors: result.value.errors,
    failed: result.value.failed,
    runStats: runtime.instrumentation.getSummary(),
  });
}

export function abortReprocessRuntime(runtime: ReprocessExecutionRuntime): void {
  if (!runtime.ingestionMonitor) {
    return;
  }

  runtime.ingestionMonitor.abort();
  void runtime.ingestionMonitor.stop().catch((error) => {
    logger.warn({ error }, 'Failed to stop ingestion monitor on abort');
  });
}

export async function runReprocess(
  ctx: CommandRuntime,
  options: { format: CliOutputFormat },
  params: ReprocessParams
): Promise<Result<ReprocessResultWithMetrics, Error>> {
  return resultTryAsync<ReprocessResultWithMetrics>(async function* () {
    const database = await ctx.openDatabaseSession();
    const result = yield* await withIngestionRuntime(
      ctx,
      database,
      {
        presentation: options.format === 'json' ? 'headless' : 'monitor',
        onAbortRegistered: (infra) => {
          const runtime = createReprocessExecutionRuntime(database, infra);
          ctx.onAbort(() => {
            abortReprocessRuntime(runtime);
          });
        },
      },
      async (infra) => {
        const runtime = createReprocessExecutionRuntime(database, infra);
        return executeReprocessWithRuntime(runtime, params);
      }
    );
    return result;
  }, 'Failed to run reprocess');
}
