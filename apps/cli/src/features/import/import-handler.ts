import {
  BlockchainProviderManager,
  initializeProviders,
  loadExplorerConfig,
  type BlockchainExplorersConfig,
} from '@exitbook/blockchain-providers';
import type { SourceType } from '@exitbook/core';
import {
  AccountRepository,
  TokenMetadataRepository,
  TransactionRepository,
  UserRepository,
  type KyselyDB,
} from '@exitbook/data';
import {
  DataSourceRepository,
  ImportOrchestrator,
  RawDataRepository,
  TokenMetadataService,
  TransactionProcessService,
  type ImportResult as ServiceImportResult,
} from '@exitbook/ingestion';
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
  private importOrchestrator: ImportOrchestrator;
  private processService: TransactionProcessService;

  constructor(
    private database: KyselyDB,
    explorerConfig?: BlockchainExplorersConfig
  ) {
    // Load explorer config
    const config = explorerConfig || loadExplorerConfig();

    // Initialize repositories
    const transactionRepository = new TransactionRepository(this.database);
    const rawDataRepository = new RawDataRepository(this.database);
    const sessionRepository = new DataSourceRepository(this.database);
    const tokenMetadataRepository = new TokenMetadataRepository(this.database);
    const userRepository = new UserRepository(this.database);
    const accountRepository = new AccountRepository(this.database);

    // Initialize provider manager
    this.providerManager = new BlockchainProviderManager(config);

    // Initialize services
    const tokenMetadataService = new TokenMetadataService(tokenMetadataRepository, this.providerManager);

    this.importOrchestrator = new ImportOrchestrator(
      userRepository,
      accountRepository,
      rawDataRepository,
      sessionRepository,
      this.providerManager
    );

    this.processService = new TransactionProcessService(
      rawDataRepository,
      sessionRepository,
      accountRepository,
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

      progress.start(`Importing from ${params.sourceName}`);

      // Call appropriate orchestrator method based on source type and params
      let importResult: Result<ServiceImportResult, Error>;

      if (params.sourceType === 'exchange') {
        if (params.csvDir) {
          // Exchange CSV import
          importResult = await this.importOrchestrator.importExchangeCsv(params.sourceName, [params.csvDir]);
        } else if (params.credentials) {
          // Exchange API import
          const credentials: Record<string, string> = {
            apiKey: params.credentials.apiKey,
            secret: params.credentials.secret,
          };
          if (params.credentials.apiPassphrase) {
            credentials.passphrase = params.credentials.apiPassphrase;
          }
          importResult = await this.importOrchestrator.importExchangeApi(params.sourceName, credentials);
        } else {
          return err(new Error('Either csvDir or credentials must be provided for exchange imports'));
        }
      } else {
        // Blockchain import
        if (!params.address) {
          return err(new Error('Address is required for blockchain imports'));
        }
        importResult = await this.importOrchestrator.importBlockchain(
          params.sourceName,
          params.address,
          params.providerName
        );
      }

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
