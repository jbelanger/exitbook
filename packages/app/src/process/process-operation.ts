import type { DataContext } from '@exitbook/data';
import type { RawDataProcessingService } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import { ClearOperation } from '../clear/clear-operation.js';
import type { EventSink } from '../pipeline/pipeline-context.js';

const logger = getLogger('ProcessOperation');

export interface ProcessParams {
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

export interface ProcessResult {
  /** Number of transactions processed */
  processed: number;

  /** Processing errors if any */
  errors: string[];
}

/**
 * Reprocess orchestration: resolve accounts → guard imports →
 * clear derived data → delegate to RawDataProcessingService.
 *
 * Uses DataContext + ClearOperation — pure app-layer policy.
 * RawDataProcessingService stays in @exitbook/ingestion.
 */
export class ProcessOperation {
  private readonly clearOperation: ClearOperation;

  constructor(
    private readonly db: DataContext,
    private readonly processingService: RawDataProcessingService,
    private readonly events?: EventSink | undefined
  ) {
    this.clearOperation = new ClearOperation(db, events);
  }

  async execute(params: ProcessParams): Promise<Result<ProcessResult, Error>> {
    const { accountId } = params;

    // 1. Resolve account IDs
    let accountIds: number[];
    if (accountId) {
      accountIds = [accountId];
    } else {
      const accountIdsResult = await this.db.rawTransactions.findDistinctAccountIds({
        processingStatus: 'pending',
      });
      if (accountIdsResult.isErr()) {
        return err(accountIdsResult.error);
      }
      accountIds = accountIdsResult.value;

      if (accountIds.length === 0) {
        logger.info('No pending raw data found to process');
        return ok({ errors: [], processed: 0 });
      }
    }

    // 2. Guard: abort before any mutation if any account has an incomplete import
    const guardResult = await this.processingService.assertNoIncompleteImports(accountIds);
    if (guardResult.isErr()) {
      return err(guardResult.error);
    }

    // 3. Clear derived data and reset raw data to pending
    const clearResult = await this.clearOperation.execute({
      accountId,
      includeRaw: false, // Keep raw data, just reset processing status
    });

    if (clearResult.isErr()) {
      return err(clearResult.error);
    }
    const deleted = clearResult.value.deleted;

    logger.info(`Cleared derived data (${deleted.links} links, ${deleted.transactions} transactions)`);

    // 4. Process imported sessions
    const processResult = await this.processingService.processImportedSessions(accountIds);
    if (processResult.isErr()) {
      return err(processResult.error);
    }

    return ok({
      processed: processResult.value.processed,
      errors: processResult.value.errors,
    });
  }
}
