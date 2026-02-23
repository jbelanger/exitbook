import type { RawDataQueries } from '@exitbook/data';
import type { ClearService, TransactionProcessingService } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

export interface BatchProcessSummary {
  /** Number of transactions processed */
  processed: number;

  /** Processing errors if any */
  errors: string[];
}

export interface ProcessHandlerParams {
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

interface ProcessDependencies {
  transactionProcessService: TransactionProcessingService;
  clearService: ClearService;
  rawDataQueries: RawDataQueries;
}

const logger = getLogger('ProcessHandler');

/**
 * Execute the reprocess operation.
 * Always clears derived data and resets raw data to pending before reprocessing.
 */
export async function executeReprocess(
  params: ProcessHandlerParams,
  deps: ProcessDependencies
): Promise<Result<BatchProcessSummary, Error>> {
  const { accountId } = params;
  const { transactionProcessService, clearService, rawDataQueries } = deps;

  // Always clear derived data and reset raw data to pending
  const clearResult = await clearService.execute({
    accountId,
    includeRaw: false, // Keep raw data, just reset processing status
  });

  if (clearResult.isErr()) {
    return err(clearResult.error);
  }
  const deleted = clearResult.value.deleted;

  logger.info(`Cleared derived data (${deleted.links} links, ${deleted.transactions} transactions)`);

  logger.info(`Reset ${deleted.transactions} transactions for reprocessing`);

  // Get account IDs to process
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
