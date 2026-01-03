import { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { ClearService, TransactionProcessService } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { err, type Result } from 'neverthrow';

const logger = getLogger('ProcessHandler');

/**
 * Result of the process operation.
 */
export interface ProcessResult {
  /** Number of transactions processed */
  processed: number;

  /** Processing errors if any */
  errors: string[];
}

/**
 * Reprocess handler parameters
 */
export interface ProcessHandlerParams {
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

/**
 * Process handler - encapsulates all process business logic.
 * Reusable by both CLI command and other contexts.
 */
export class ProcessHandler {
  private providerManager: BlockchainProviderManager;

  constructor(
    private transactionProcessService: TransactionProcessService,
    providerManager?: BlockchainProviderManager,
    private clearService?: ClearService
  ) {
    // Use provided provider manager or create new one
    this.providerManager = providerManager ?? new BlockchainProviderManager();
  }

  /**
   * Execute the reprocess operation.
   * Always clears derived data and resets raw data to pending before reprocessing.
   */
  async execute(params: ProcessHandlerParams): Promise<Result<ProcessResult, Error>> {
    const { accountId } = params;

    // Always clear derived data and reset raw data to pending
    if (!this.clearService) {
      return err(new Error('Clear service is required for reprocessing'));
    }

    const clearResult = await this.clearService.execute({
      accountId,
      includeRaw: false, // Keep raw data, just reset processing status
    });

    if (clearResult.isErr()) {
      return err(clearResult.error);
    }
    const deleted = clearResult.value.deleted;

    logger.info(
      `Cleared derived data (${deleted.links} links, ${deleted.lots} lots, ${deleted.disposals} disposals, ${deleted.calculations} calculations)`
    );

    logger.info(`Reset ${deleted.transactions} transactions for reprocessing`);

    // Process transactions
    if (accountId) {
      return this.transactionProcessService.processAccountTransactions(accountId);
    } else {
      return this.transactionProcessService.processAllPending();
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.providerManager.destroy();
  }
}
