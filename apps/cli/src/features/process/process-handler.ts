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
 * Process handler parameters
 */
export interface ProcessHandlerParams {
  /** Force reprocessing by clearing derived data and resetting raw data to pending */
  force?: boolean | undefined;

  /** Process only a specific account ID */
  accountId?: number | undefined;
}

/**
 * Process handler - encapsulates all process business logic.
 * Reusable by both CLI command and other contexts.
 */
export class ProcessHandler {
  private providerManager: BlockchainProviderManager;

  constructor(
    private processService: TransactionProcessService,
    providerManager?: BlockchainProviderManager,
    private clearService?: ClearService
  ) {
    // Use provided provider manager or create new one
    this.providerManager = providerManager ?? new BlockchainProviderManager();
  }

  /**
   * Execute the process operation.
   */
  async execute(params: ProcessHandlerParams): Promise<Result<ProcessResult, Error>> {
    const { force, accountId } = params;

    // Handle --force flag: clear derived data and reset raw data to pending
    if (force) {
      if (!this.clearService) {
        return err(new Error('Clear service is required when using --force flag'));
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
    }

    // Process transactions
    if (accountId) {
      return this.processService.processAccountTransactions(accountId);
    } else {
      return this.processService.processAllPending();
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.providerManager.destroy();
  }
}
