import { BlockchainProviderManager, loadExplorerConfig } from '@exitbook/blockchain-providers';
import type { KyselyDB } from '@exitbook/data';
import { TokenMetadataRepository, TransactionRepository } from '@exitbook/data';
import {
  DataSourceRepository,
  RawDataRepository,
  TokenMetadataService,
  TransactionProcessService,
} from '@exitbook/ingestion';
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
  private processService: TransactionProcessService;
  private providerManager: BlockchainProviderManager;

  constructor(private database: KyselyDB) {
    // Initialize services
    const config = loadExplorerConfig();
    const transactionRepository = new TransactionRepository(this.database);
    const rawDataRepository = new RawDataRepository(this.database);
    const sessionRepository = new DataSourceRepository(this.database);
    const tokenMetadataRepository = new TokenMetadataRepository(this.database);
    this.providerManager = new BlockchainProviderManager(config);
    const tokenMetadataService = new TokenMetadataService(tokenMetadataRepository, this.providerManager);

    this.processService = new TransactionProcessService(
      rawDataRepository,
      sessionRepository,
      transactionRepository,
      tokenMetadataService
    );
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
