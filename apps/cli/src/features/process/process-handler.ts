import { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { IRawDataRepository } from '@exitbook/data';
import type { TransactionProcessService } from '@exitbook/ingestion';
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
  /** Force reprocessing by resetting processing status */
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
    private rawDataRepository?: IRawDataRepository
  ) {
    // Use provided provider manager or create new one
    this.providerManager = providerManager ?? new BlockchainProviderManager();
  }

  /**
   * Execute the process operation.
   */
  async execute(params: ProcessHandlerParams): Promise<Result<ProcessResult, Error>> {
    const { force, accountId } = params;

    // Handle --force flag: reset processing status
    if (force) {
      if (!this.rawDataRepository) {
        return err(new Error('Raw data repository is required when using --force flag'));
      }

      logger.info('Resetting processing status for raw data...');
      const resetResult = accountId
        ? await this.rawDataRepository.resetProcessingStatusByAccount(accountId)
        : await this.rawDataRepository.resetProcessingStatusAll();

      if (resetResult.isErr()) {
        return err(resetResult.error);
      }

      const resetCount = resetResult.value;
      logger.info(`Reset ${resetCount} raw data items to pending status`);
    }

    // Process transactions
    if (accountId) {
      logger.info(`Processing pending data for account ${accountId}`);
      return this.processService.processAccountTransactions(accountId);
    } else {
      logger.info('Processing all pending data from all sources');
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
