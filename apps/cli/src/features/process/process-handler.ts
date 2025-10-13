import { TransactionRepository, type KyselyDB } from '@exitbook/data';
import {
  DefaultNormalizer,
  ImporterFactory,
  ImportSessionErrorRepository,
  ImportSessionRepository,
  PriceEnrichmentService,
  ProcessorFactory,
  RawDataRepository,
  TransactionIngestionService,
} from '@exitbook/import';
import {
  BlockchainProviderManager,
  initializeProviders,
  loadExplorerConfig,
  type BlockchainExplorersConfig,
} from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { ProcessHandlerParams } from './process-utils.ts';
import { validateProcessParams } from './process-utils.ts';

// Re-export for convenience
export type { ProcessHandlerParams };

// Initialize all providers at startup
initializeProviders();

const logger = getLogger('ProcessHandler');

/**
 * Result of the process operation.
 */
export interface ProcessResult {
  /** Number of transactions processed */
  processed: number;

  /** Number of transactions enriched with prices */
  pricesEnriched: number;

  /** Processing errors if any */
  errors: string[];
}

/**
 * Process handler - encapsulates all process business logic.
 * Reusable by both CLI command and other contexts.
 */
export class ProcessHandler {
  private providerManager: BlockchainProviderManager;
  private ingestionService: TransactionIngestionService;
  private priceEnrichmentService: PriceEnrichmentService;

  constructor(
    private database: KyselyDB,
    explorerConfig?: BlockchainExplorersConfig
  ) {
    // Load explorer config
    const config = explorerConfig || loadExplorerConfig();

    // Initialize services
    const transactionRepository = new TransactionRepository(this.database);
    const rawDataRepository = new RawDataRepository(this.database);
    const sessionRepository = new ImportSessionRepository(this.database);
    const sessionErrorRepository = new ImportSessionErrorRepository(this.database);
    this.providerManager = new BlockchainProviderManager(config);
    const importerFactory = new ImporterFactory(this.providerManager);
    const processorFactory = new ProcessorFactory();
    const normalizer = new DefaultNormalizer();

    this.ingestionService = new TransactionIngestionService(
      rawDataRepository,
      sessionRepository,
      sessionErrorRepository,
      transactionRepository,
      importerFactory,
      processorFactory,
      normalizer
    );

    this.priceEnrichmentService = new PriceEnrichmentService(transactionRepository);
  }

  /**
   * Execute the process operation.
   */
  async execute(params: ProcessHandlerParams): Promise<Result<ProcessResult, Error>> {
    try {
      // Validate parameters
      const validation = validateProcessParams(params);
      if (validation.isErr()) {
        return err(validation.error);
      }

      logger.info(
        `Starting data processing from ${params.sourceName} (${params.sourceType}) to universal transaction format`
      );

      // Process raw data to transactions
      const processResult = await this.ingestionService.processRawDataToTransactions(
        params.sourceName,
        params.sourceType,
        params.filters
      );

      if (processResult.isErr()) {
        return err(processResult.error);
      }

      const result = processResult.value;

      if (result.errors.length > 0) {
        logger.warn(`Processing completed with ${result.errors.length} errors`);
      } else {
        logger.info(`Processing completed: ${result.processed} transactions processed`);
      }

      // Enrich prices from transaction data (before calling external price providers)
      logger.info('Enriching prices from transaction data');
      const enrichmentResult = await this.priceEnrichmentService.enrichPrices();

      let pricesEnriched = 0;
      if (enrichmentResult.isErr()) {
        logger.warn(`Price enrichment failed: ${enrichmentResult.error.message}`);
      } else {
        pricesEnriched = enrichmentResult.value.transactionsUpdated;
        logger.info(`Price enrichment completed: ${pricesEnriched} transactions enriched`);
      }

      return ok({
        processed: result.processed,
        pricesEnriched,
        errors: result.errors,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.providerManager.destroy();
  }
}
