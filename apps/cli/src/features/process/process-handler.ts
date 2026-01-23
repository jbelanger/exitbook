import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { ClearService, TransactionProcessService } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { err, type Result } from 'neverthrow';

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
  private readonly logger = getLogger('ProcessHandler');
  private providerManager: BlockchainProviderManager;

  constructor(
    private transactionProcessService: TransactionProcessService,
    providerManager: BlockchainProviderManager,
    private clearService: ClearService
  ) {
    this.providerManager = providerManager;
  }

  /**
   * Execute the reprocess operation.
   * Always clears derived data and resets raw data to pending before reprocessing.
   */
  async execute(params: ProcessHandlerParams): Promise<Result<ProcessResult, Error>> {
    const { accountId } = params;

    // Always clear derived data and reset raw data to pending
    const clearResult = await this.clearService.execute({
      accountId,
      includeRaw: false, // Keep raw data, just reset processing status
    });

    if (clearResult.isErr()) {
      return err(clearResult.error);
    }
    const deleted = clearResult.value.deleted;

    this.logger.info(
      `Cleared derived data (${deleted.links} links, ${deleted.lots} lots, ${deleted.disposals} disposals, ${deleted.calculations} calculations)`
    );

    this.logger.info(`Reset ${deleted.transactions} transactions for reprocessing`);

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
