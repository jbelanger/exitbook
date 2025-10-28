import type { SourceType } from '@exitbook/core';
import { TokenMetadataRepository, TransactionRepository, type KyselyDB } from '@exitbook/data';
import {
  DataSourceRepository,
  RawDataRepository,
  TokenMetadataService,
  TransactionImportService,
  TransactionProcessService,
} from '@exitbook/ingestion';
import type { ImportParams } from '@exitbook/ingestion';
import {
  BlockchainProviderManager,
  initializeProviders,
  loadExplorerConfig,
  type BlockchainExplorersConfig,
} from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import { validateImportParams } from './import-utils.ts';

// Initialize all providers at startup
initializeProviders();

const logger = getLogger('ImportHandler');

/**
 * Parameters for the import handler.
 */
export interface ImportHandlerParams {
  /** Source name (exchange or blockchain) */
  sourceName: string;

  /** Source type */
  sourceType: SourceType;

  /** CSV directory path (for exchange CSV imports) */
  csvDir?: string | undefined;

  /** Wallet address (for blockchain imports) */
  address?: string | undefined;

  /** Provider ID (for blockchain imports) */
  providerId?: string | undefined;

  /** API credentials (for exchange API imports) */
  credentials?:
    | {
        apiKey: string;
        apiPassphrase?: string | undefined;
        secret: string;
      }
    | undefined;

  /** Whether to process data after import */
  shouldProcess?: boolean | undefined;

  /** Import session ID (for processing existing data) */
  dataSourceId?: number | undefined;
}

/**
 * Result of the import operation.
 */
export interface ImportResult {
  /** Import session ID */
  dataSourceId: number;

  /** Number of items imported */
  imported: number;

  /** Number of items processed (if shouldProcess is true) */
  processed?: number | undefined;

  /** Processing errors (if shouldProcess is true) */
  processingErrors?: string[] | undefined;
}

/**
 * Import handler - encapsulates all import business logic.
 * Reusable by both CLI command and other contexts.
 */
export class ImportHandler {
  private providerManager: BlockchainProviderManager;
  private importService: TransactionImportService;
  private processService: TransactionProcessService;

  constructor(
    private database: KyselyDB,
    explorerConfig?: BlockchainExplorersConfig
  ) {
    // Load explorer config
    const config = explorerConfig || loadExplorerConfig();

    // Initialize services
    const transactionRepository = new TransactionRepository(this.database);
    const rawDataRepository = new RawDataRepository(this.database);
    const sessionRepository = new DataSourceRepository(this.database);
    const tokenMetadataRepository = new TokenMetadataRepository(this.database);
    this.providerManager = new BlockchainProviderManager(config);
    const tokenMetadataService = new TokenMetadataService(tokenMetadataRepository, this.providerManager);

    this.importService = new TransactionImportService(rawDataRepository, sessionRepository, this.providerManager);
    this.processService = new TransactionProcessService(
      rawDataRepository,
      sessionRepository,
      transactionRepository,
      tokenMetadataService
    );
  }

  /**
   * Execute the import operation.
   */
  async execute(params: ImportHandlerParams): Promise<Result<ImportResult, Error>> {
    try {
      // Validate parameters
      const validation = validateImportParams(params);
      if (validation.isErr()) {
        return err(validation.error);
      }

      logger.info(`Starting data import from ${params.sourceName} (${params.sourceType})`);

      // Build import params
      const importParams: ImportParams = {};
      if (params.sourceType === 'exchange') {
        if (params.csvDir) {
          importParams.csvDirectories = [params.csvDir];
        } else if (params.credentials) {
          const credentials: Record<string, string> = {
            apiKey: params.credentials.apiKey,
            secret: params.credentials.secret,
          };
          if (params.credentials.apiPassphrase) {
            credentials.passphrase = params.credentials.apiPassphrase;
          }
          importParams.credentials = credentials;
        }
      } else {
        importParams.address = params.address;
        importParams.providerId = params.providerId;
      }

      // Import raw data
      const importResult = await this.importService.importFromSource(
        params.sourceName,
        params.sourceType,
        importParams
      );

      if (importResult.isErr()) {
        return err(importResult.error);
      }

      const importData = importResult.value;
      logger.info(`Import completed: ${importData.imported} items imported`);
      logger.info(`Session ID: ${importData.dataSourceId}`);

      const result: ImportResult = {
        dataSourceId: importData.dataSourceId,
        imported: importData.imported,
      };

      // Process data if requested
      if (params.shouldProcess) {
        logger.info('Processing imported data to universal format');

        const processResult = await this.processService.processRawDataToTransactions(
          params.sourceName,
          params.sourceType,
          {
            dataSourceId: importData.dataSourceId,
          }
        );

        if (processResult.isErr()) {
          return err(processResult.error);
        }

        result.processed = processResult.value.processed;
        result.processingErrors = processResult.value.errors;

        if (processResult.value.errors.length > 0) {
          logger.warn(`Processing completed with ${processResult.value.errors.length} errors`);
        } else {
          logger.info(`Processing completed: ${processResult.value.processed} transactions processed`);
        }
      }

      return ok(result);
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
