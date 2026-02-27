// eslint-disable-next-line no-restricted-imports -- ok here since this is the CLI boundary
import type { KyselyDB, RawDataQueries } from '@exitbook/data';
import { createRawDataQueries } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/http';
import {
  ClearService,
  type AdapterRegistry,
  type IngestionEvent,
  type TransactionProcessingService,
} from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { EventDrivenController } from '../../ui/shared/index.js';
import type { CommandContext } from '../shared/command-runtime.js';
import { createIngestionInfrastructure, type CliEvent } from '../shared/ingestion-infrastructure.js';

export interface BatchProcessSummary {
  /** Number of transactions processed */
  processed: number;

  /** Processing errors if any */
  errors: string[];
}

export interface BatchProcessSummaryWithMetrics extends BatchProcessSummary {
  runStats: MetricsSummary;
}

export interface ProcessHandlerParams {
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

const logger = getLogger('ProcessHandler');

/**
 * Execute the reprocess operation.
 * Always clears derived data and resets raw data to pending before reprocessing.
 */
export async function executeReprocess(
  params: ProcessHandlerParams,
  deps: {
    clearService: ClearService;
    rawDataQueries: RawDataQueries;
    transactionProcessService: TransactionProcessingService;
  }
): Promise<Result<BatchProcessSummary, Error>> {
  const { accountId } = params;
  const { transactionProcessService, clearService, rawDataQueries } = deps;

  // Resolve account IDs before any mutation
  let accountIds: number[];
  if (accountId) {
    accountIds = [accountId];
  } else {
    const accountIdsResult = await rawDataQueries.getAccountsWithPendingData();
    if (accountIdsResult.isErr()) {
      return err(accountIdsResult.error);
    }
    accountIds = accountIdsResult.value;

    if (accountIds.length === 0) {
      logger.info('No pending raw data found to process');
      return ok({ errors: [], processed: 0 });
    }
  }

  // Guard: abort before any mutation if any account has an incomplete import
  const guardResult = await transactionProcessService.assertNoIncompleteImports(accountIds);
  if (guardResult.isErr()) {
    return err(guardResult.error);
  }

  // Clear derived data and reset raw data to pending
  const clearResult = await clearService.execute({
    accountId,
    includeRaw: false, // Keep raw data, just reset processing status
  });

  if (clearResult.isErr()) {
    return err(clearResult.error);
  }
  const deleted = clearResult.value.deleted;

  logger.info(`Cleared derived data (${deleted.links} links, ${deleted.transactions} transactions)`);

  // Use processImportedSessions which emits dashboard events
  const processResult = await transactionProcessService.processImportedSessions(accountIds);
  if (processResult.isErr()) {
    return err(processResult.error);
  }

  return ok({
    processed: processResult.value.processed,
    errors: processResult.value.errors,
  });
}

export class ProcessHandler {
  static create(
    transactionProcessService: TransactionProcessingService,
    clearService: ClearService,
    rawDataQueries: RawDataQueries,
    ingestionMonitor: EventDrivenController<CliEvent>,
    instrumentation: InstrumentationCollector
  ): ProcessHandler {
    return new ProcessHandler(
      transactionProcessService,
      clearService,
      rawDataQueries,
      ingestionMonitor,
      instrumentation
    );
  }

  private constructor(
    private readonly transactionProcessService: TransactionProcessingService,
    private readonly clearService: ClearService,
    private readonly rawDataQueries: RawDataQueries,
    private readonly ingestionMonitor: EventDrivenController<CliEvent>,
    private readonly instrumentation: InstrumentationCollector
  ) {}

  async execute(params: ProcessHandlerParams): Promise<Result<BatchProcessSummaryWithMetrics, Error>> {
    const result = await executeReprocess(params, {
      transactionProcessService: this.transactionProcessService,
      clearService: this.clearService,
      rawDataQueries: this.rawDataQueries,
    });

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
  database: KyselyDB,
  registry: AdapterRegistry
): Promise<Result<ProcessHandler, Error>> {
  try {
    const infra = await createIngestionInfrastructure(ctx, database, registry);
    const rawDataQueries = createRawDataQueries(database);
    const clearService = new ClearService(database, infra.eventBus as EventBus<IngestionEvent>);

    return ok(
      ProcessHandler.create(
        infra.transactionProcessService,
        clearService,
        rawDataQueries,
        infra.ingestionMonitor,
        infra.instrumentation
      )
    );
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
