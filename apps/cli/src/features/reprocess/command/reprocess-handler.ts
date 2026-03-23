import type { DataContext } from '@exitbook/data';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { ProcessingWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/observability';

import type { CommandScope } from '../../../runtime/command-scope.js';
import type { EventDrivenController } from '../../../ui/shared/index.js';
import { resetProjections } from '../../shared/consumer-input-prereqs.js';
import type { InfrastructureHandler } from '../../shared/handler-contracts.js';
import { createIngestionInfrastructure, type CliEvent } from '../../shared/ingestion-infrastructure.js';

export interface ProcessResultWithMetrics {
  processed: number;
  errors: string[];
  failed: number;
  runStats: MetricsSummary;
}

interface ReprocessHandlerParams {
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

const logger = getLogger('ReprocessHandler');

export class ReprocessHandler implements InfrastructureHandler<ReprocessHandlerParams, ProcessResultWithMetrics> {
  constructor(
    private readonly database: DataContext,
    private readonly processingWorkflow: ProcessingWorkflow,
    private readonly ingestionMonitor: EventDrivenController<CliEvent>,
    private readonly instrumentation: InstrumentationCollector
  ) {}

  async execute(params: ReprocessHandlerParams): Promise<Result<ProcessResultWithMetrics, Error>> {
    // 1. Plan: resolve accounts, guard incomplete imports (no mutations)
    const planResult = await this.processingWorkflow.prepareReprocess(params);
    if (planResult.isErr()) {
      this.ingestionMonitor.fail(planResult.error.message);
      await this.ingestionMonitor.stop();
      return err(planResult.error);
    }

    const plan = planResult.value;
    if (!plan) {
      await this.ingestionMonitor.stop();
      return ok({ processed: 0, errors: [], failed: 0, runStats: this.instrumentation.getSummary() });
    }

    // 2. Reset projections in graph order (downstream first)
    const resetResult = await resetProjections(this.database, 'processed-transactions', plan.accountIds);
    if (resetResult.isErr()) {
      this.ingestionMonitor.fail(resetResult.error.message);
      await this.ingestionMonitor.stop();
      return err(resetResult.error);
    }
    logger.info('Reset projections for reprocess');

    // 4. Process raw data
    const result = await this.processingWorkflow.processImportedSessions(plan.accountIds);

    if (result.isErr()) {
      this.ingestionMonitor.fail(result.error.message);
      await this.ingestionMonitor.stop();
      return err(result.error);
    }

    if (result.value.failed > 0) {
      const firstErrors = result.value.errors.slice(0, 5).join('; ');
      const errorMessage =
        `Reprocess failed: ${result.value.failed} account(s) failed during processing. ` +
        (firstErrors.length > 0 ? `First errors: ${firstErrors}` : 'See logs for details.');

      this.ingestionMonitor.fail(errorMessage);
      await this.ingestionMonitor.stop();
      return err(new Error(errorMessage));
    }

    await this.ingestionMonitor.stop();
    return ok({
      processed: result.value.processed,
      errors: result.value.errors,
      failed: result.value.failed,
      runStats: this.instrumentation.getSummary(),
    });
  }

  abort(): void {
    this.ingestionMonitor.abort();
    void this.ingestionMonitor.stop().catch((e) => {
      logger.warn({ e }, 'Failed to stop ingestion monitor on abort');
    });
  }
}

export async function createReprocessHandler(ctx: CommandScope): Promise<Result<ReprocessHandler, Error>> {
  try {
    const database = await ctx.database();
    const infra = await createIngestionInfrastructure(ctx, database);

    return ok(new ReprocessHandler(database, infra.processingWorkflow, infra.ingestionMonitor, infra.instrumentation));
  } catch (error) {
    return wrapError(error, 'Failed to create reprocess handler');
  }
}
