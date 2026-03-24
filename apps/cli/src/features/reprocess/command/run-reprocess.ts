import type { DataContext } from '@exitbook/data/context';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { ProcessingWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/observability';

import type { CommandScope } from '../../../runtime/command-scope.js';
import { createIngestionRuntime, type CliEvent } from '../../../runtime/ingestion-runtime.js';
import type { EventDrivenController } from '../../../ui/shared/index.js';
import { resetProjections } from '../../shared/projection-reset.js';

export interface ProcessResultWithMetrics {
  processed: number;
  errors: string[];
  failed: number;
  runStats: MetricsSummary;
}

interface ReprocessParams {
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

const logger = getLogger('ReprocessRunner');

export interface ReprocessExecutionRuntime {
  database: DataContext;
  processingWorkflow: ProcessingWorkflow;
  ingestionMonitor?: EventDrivenController<CliEvent> | undefined;
  instrumentation: InstrumentationCollector;
}

export async function executeReprocessWithRuntime(
  runtime: ReprocessExecutionRuntime,
  params: ReprocessParams
): Promise<Result<ProcessResultWithMetrics, Error>> {
  const planResult = await runtime.processingWorkflow.prepareReprocess(params);
  if (planResult.isErr()) {
    runtime.ingestionMonitor?.fail(planResult.error.message);
    await runtime.ingestionMonitor?.stop();
    return err(planResult.error);
  }

  const plan = planResult.value;
  if (!plan) {
    await runtime.ingestionMonitor?.stop();
    return ok({ processed: 0, errors: [], failed: 0, runStats: runtime.instrumentation.getSummary() });
  }

  const resetResult = await resetProjections(runtime.database, 'processed-transactions', plan.accountIds);
  if (resetResult.isErr()) {
    runtime.ingestionMonitor?.fail(resetResult.error.message);
    await runtime.ingestionMonitor?.stop();
    return err(resetResult.error);
  }
  logger.info('Reset projections for reprocess');

  const result = await runtime.processingWorkflow.processImportedSessions(plan.accountIds);
  if (result.isErr()) {
    runtime.ingestionMonitor?.fail(result.error.message);
    await runtime.ingestionMonitor?.stop();
    return err(result.error);
  }

  if (result.value.failed > 0) {
    const firstErrors = result.value.errors.slice(0, 5).join('; ');
    const errorMessage =
      `Reprocess failed: ${result.value.failed} account(s) failed during processing. ` +
      (firstErrors.length > 0 ? `First errors: ${firstErrors}` : 'See logs for details.');

    runtime.ingestionMonitor?.fail(errorMessage);
    await runtime.ingestionMonitor?.stop();
    return err(new Error(errorMessage));
  }

  await runtime.ingestionMonitor?.stop();
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
  ctx: CommandScope,
  options: { isJsonMode: boolean },
  params: ReprocessParams
): Promise<Result<ProcessResultWithMetrics, Error>> {
  try {
    const database = await ctx.database();
    const infra = await createIngestionRuntime(ctx, database, {
      presentation: options.isJsonMode ? 'headless' : 'monitor',
    });
    const runtime: ReprocessExecutionRuntime = {
      database,
      processingWorkflow: infra.processingWorkflow,
      ingestionMonitor: infra.ingestionMonitor,
      instrumentation: infra.instrumentation,
    };

    ctx.onAbort(() => {
      abortReprocessRuntime(runtime);
    });
    return executeReprocessWithRuntime(runtime, params);
  } catch (error) {
    return wrapError(error, 'Failed to run reprocess');
  }
}
