import { err, ok, type Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { buildAccountingResetPorts, buildIngestionResetPorts } from '@exitbook/data';
import type { AdapterRegistry, ProcessingWorkflow } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/observability';

import type { EventDrivenController } from '../../ui/shared/index.js';
import type { CommandContext } from '../shared/command-runtime.js';
import { createIngestionInfrastructure, type CliEvent } from '../shared/ingestion-infrastructure.js';

export interface ProcessResultWithMetrics {
  processed: number;
  errors: string[];
  runStats: MetricsSummary;
}

export interface ProcessHandlerParams {
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

const logger = getLogger('ProcessHandler');

export class ProcessHandler {
  constructor(
    private readonly database: DataContext,
    private readonly processingWorkflow: ProcessingWorkflow,
    private readonly ingestionMonitor: EventDrivenController<CliEvent>,
    private readonly instrumentation: InstrumentationCollector
  ) {}

  async execute(params: ProcessHandlerParams): Promise<Result<ProcessResultWithMetrics, Error>> {
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
      return ok({ processed: 0, errors: [], runStats: this.instrumentation.getSummary() });
    }

    // 2. Accounting reset (links, consolidated movements)
    const accountingReset = buildAccountingResetPorts(this.database);
    const accountingResult = await accountingReset.resetDerivedData(plan.accountIds);
    if (accountingResult.isErr()) {
      this.ingestionMonitor.fail(accountingResult.error.message);
      await this.ingestionMonitor.stop();
      return err(accountingResult.error);
    }
    logger.info(
      `Reset accounting data (${accountingResult.value.links} links, ${accountingResult.value.consolidatedMovements} consolidated movements)`
    );

    // 3. Ingestion reset (transactions + raw processing status)
    const ingestionReset = buildIngestionResetPorts(this.database);
    const ingestionResult = await ingestionReset.resetDerivedData(plan.accountIds);
    if (ingestionResult.isErr()) {
      this.ingestionMonitor.fail(ingestionResult.error.message);
      await this.ingestionMonitor.stop();
      return err(ingestionResult.error);
    }
    logger.info(`Reset ingestion data (${ingestionResult.value.transactions} transactions)`);

    // 4. Process raw data
    const result = await this.processingWorkflow.processImportedSessions(plan.accountIds);

    if (result.isErr()) {
      this.ingestionMonitor.fail(result.error.message);
      await this.ingestionMonitor.stop();
      return err(result.error);
    }

    await this.ingestionMonitor.stop();
    return ok({
      processed: result.value.processed,
      errors: result.value.errors,
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

export async function createProcessHandler(
  ctx: CommandContext,
  database: DataContext,
  registry: AdapterRegistry
): Promise<Result<ProcessHandler, Error>> {
  try {
    const infra = await createIngestionInfrastructure(ctx, database, registry);

    return ok(new ProcessHandler(database, infra.processingWorkflow, infra.ingestionMonitor, infra.instrumentation));
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
