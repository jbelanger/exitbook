import { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { TransactionProcessService } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { type Result } from 'neverthrow';

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
 * Process handler - encapsulates all process business logic.
 * Reusable by both CLI command and other contexts.
 */
export class ProcessHandler {
  private providerManager: BlockchainProviderManager;

  constructor(
    private processService: TransactionProcessService,
    providerManager?: BlockchainProviderManager
  ) {
    // Use provided provider manager or create new one
    this.providerManager = providerManager ?? new BlockchainProviderManager();
  }

  /**
   * Execute the process operation.
   */
  async execute(_params: Record<string, never>): Promise<Result<ProcessResult, Error>> {
    logger.info('Processing all pending data from all sources');
    return this.processService.processAllPending();
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.providerManager.destroy();
  }
}
