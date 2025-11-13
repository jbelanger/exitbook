import {
  BlockchainProviderManager,
  initializeProviders,
  loadExplorerConfig,
  type BlockchainExplorersConfig,
} from '@exitbook/blockchain-providers';
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
import { progress } from '@exitbook/ui';
import { err, ok, type Result } from 'neverthrow';

import { validateImportParams } from './import-utils.js';

// Initialize all providers at startup
initializeProviders();

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

  /** Provider Name (for blockchain imports) */
  providerName?: string | undefined;

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
        importParams.providerName = params.providerName;
      }

      progress.start(`Importing from ${params.sourceName}`);

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

      const result: ImportResult = {
        dataSourceId: importData.dataSourceId,
        imported: importData.imported,
      };

      // Process data if requested
      if (params.shouldProcess) {
        progress.update(`Processing ${importData.imported} transactions...`);
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
