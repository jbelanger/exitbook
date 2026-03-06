import { ProcessOperation, type ProcessResult } from '@exitbook/app';
import { err, ok, type Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/observability';

import type { EventDrivenController } from '../../ui/shared/index.js';
import type { CommandContext } from '../shared/command-runtime.js';
import { createIngestionInfrastructure, type CliEvent } from '../shared/ingestion-infrastructure.js';

export type { ProcessResult } from '@exitbook/app';

export interface ProcessResultWithMetrics extends ProcessResult {
  runStats: MetricsSummary;
}

export interface ProcessHandlerParams {
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

const logger = getLogger('ProcessHandler');

export class ProcessHandler {
  constructor(
    private readonly processOperation: ProcessOperation,
    private readonly ingestionMonitor: EventDrivenController<CliEvent>,
    private readonly instrumentation: InstrumentationCollector
  ) {}

  async execute(params: ProcessHandlerParams): Promise<Result<ProcessResultWithMetrics, Error>> {
    const result = await this.processOperation.execute(params);

    if (result.isErr()) {
      this.ingestionMonitor.fail(result.error.message);
      await this.ingestionMonitor.stop();
      return err(result.error);
    }

    await this.ingestionMonitor.stop();
    return ok({ ...result.value, runStats: this.instrumentation.getSummary() });
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
    const processOperation = new ProcessOperation(database, infra.rawDataProcessingService, infra.eventBus);

    return ok(new ProcessHandler(processOperation, infra.ingestionMonitor, infra.instrumentation));
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
