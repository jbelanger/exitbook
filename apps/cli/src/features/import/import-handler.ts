import {
  BlockchainProviderManager,
  initializeProviders,
  type BlockchainExplorersConfig,
} from '@exitbook/blockchain-providers';
import type { ImportSession, SourceType } from '@exitbook/core';
import type { ImportOrchestrator, TransactionProcessService } from '@exitbook/ingestion';
import { getBlockchainAdapter } from '@exitbook/ingestion';
import { progress } from '@exitbook/ui';
import { err, ok, type Result } from 'neverthrow';

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

  /** Xpub gap limit (for xpub/extended public key imports) */
  xpubGap?: number | undefined;

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
  importSessionId?: number | undefined;

  /** Callback to warn user about single address imports (returns false to abort) */
  onSingleAddressWarning?: (() => Promise<boolean>) | undefined;
}

/**
 * Result of the import operation.
 * Can be single ImportSession or array of ImportSessions (for xpub imports).
 */
export interface ImportResult {
  /** Import sessions (array for xpub imports, single for regular imports) */
  sessions: ImportSession[];

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

  constructor(
    private importOrchestrator: ImportOrchestrator,
    private processService: TransactionProcessService,
    providerManager?: BlockchainProviderManager,
    explorerConfig?: BlockchainExplorersConfig
  ) {
    // Use provided provider manager or create new one
    this.providerManager = providerManager ?? new BlockchainProviderManager(explorerConfig);
  }

  /**
   * Execute the import operation.
   */
  async execute(params: ImportHandlerParams): Promise<Result<ImportResult, Error>> {
    try {
      progress.start(`Importing from ${params.sourceName}`);

      // Call appropriate orchestrator method based on source type and params
      let importResult: Result<ImportSession | ImportSession[], Error>;

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

        // Check if this is a single address (not xpub) and warn user
        const blockchainAdapter = getBlockchainAdapter(params.sourceName.toLowerCase());
        if (blockchainAdapter?.isExtendedPublicKey) {
          const isXpub = blockchainAdapter.isExtendedPublicKey(params.address);
          if (!isXpub && params.onSingleAddressWarning) {
            const shouldContinue = await params.onSingleAddressWarning();
            if (!shouldContinue) {
              return err(new Error('Import cancelled by user'));
            }
          }
        }

        importResult = await this.importOrchestrator.importBlockchain(
          params.sourceName,
          params.address,
          params.providerName,
          params.xpubGap
        );
      }

      if (importResult.isErr()) {
        return err(importResult.error);
      }

      // Normalize to array
      const sessions = Array.isArray(importResult.value) ? importResult.value : [importResult.value];

      const result: ImportResult = {
        sessions,
      };

      // Process data if requested
      if (params.shouldProcess) {
        const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);
        progress.update(`Processing ${totalImported} transactions...`);
        const processResult = await this.processService.processAllPending();

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
