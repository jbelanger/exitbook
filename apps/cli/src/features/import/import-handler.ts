import {
  BlockchainProviderManager,
  initializeProviders,
  type BlockchainExplorersConfig,
} from '@exitbook/blockchain-providers';
import type { ImportSession } from '@exitbook/core';
import type { ImportOrchestrator, ImportParams, TransactionProcessService } from '@exitbook/ingestion';
import { getBlockchainAdapter } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

// Initialize all providers at startup
initializeProviders();

/**
 * Result of the import operation.
 * Can be single ImportSession or array of ImportSessions (for xpub imports).
 */
export interface ImportResult {
  /** Import sessions (array for xpub imports, single for regular imports) */
  sessions: ImportSession[];
}

/**
 * Result of the processing operation.
 */
export interface ProcessResult {
  /** Number of items processed */
  processed: number;

  /** Processing errors */
  processingErrors: string[];
}

/**
 * Import handler - encapsulates all import business logic.
 * Reusable by both CLI command and other contexts.
 */
export class ImportHandler {
  private readonly logger = getLogger('ImportHandler');
  private providerManager: BlockchainProviderManager;

  constructor(
    private importOrchestrator: ImportOrchestrator,
    private transactionProcessService: TransactionProcessService,
    providerManager?: BlockchainProviderManager,
    explorerConfig?: BlockchainExplorersConfig
  ) {
    // Use provided provider manager or create new one
    this.providerManager = providerManager ?? new BlockchainProviderManager(explorerConfig);
  }

  /**
   * Execute the import operation (without processing).
   */
  async executeImport(params: ImportParams): Promise<Result<ImportResult, Error>> {
    try {
      // Call appropriate orchestrator method based on source type
      let importResult: Result<ImportSession | ImportSession[], Error>;

      if (params.sourceType === 'exchange-csv') {
        // Exchange CSV import
        if (!params.csvDirectory) {
          return err(new Error('CSV directory is required for CSV imports'));
        }
        importResult = await this.importOrchestrator.importExchangeCsv(params.sourceName, params.csvDirectory);
      } else if (params.sourceType === 'exchange-api') {
        // Exchange API import
        if (!params.credentials) {
          return err(new Error('Credentials are required for API imports'));
        }
        importResult = await this.importOrchestrator.importExchangeApi(params.sourceName, params.credentials);
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

      const incompleteSessions = sessions.filter((session) => session.status !== 'completed');
      if (incompleteSessions.length > 0) {
        const accountStatuses = incompleteSessions.map((session) => `${session.accountId}(${session.status})`);
        return err(
          new Error(
            `Import did not complete for account(s): ${accountStatuses.join(', ')}. ` +
              `Processing is blocked until all imports complete successfully.`
          )
        );
      }

      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Execute the processing operation for imported sessions.
   */
  async processImportedSessions(sessions: ImportSession[]): Promise<Result<ProcessResult, Error>> {
    try {
      const totalImported = sessions.reduce((sum, s) => sum + s.transactionsImported, 0);

      if (totalImported === 0) {
        this.logger.debug('No transactions imported, skipping processing');
        return ok({
          processed: 0,
          processingErrors: [],
        });
      }

      this.logger.info(`Processing ${totalImported} transactions...`);

      // Process only the accounts that were imported
      const uniqueAccountIds = [...new Set(sessions.map((s) => s.accountId))];
      let totalProcessed = 0;
      const allErrors: string[] = [];

      for (const accountId of uniqueAccountIds) {
        const processResult = await this.transactionProcessService.processAccountTransactions(accountId);

        if (processResult.isErr()) {
          return err(processResult.error);
        }

        totalProcessed += processResult.value.processed;
        allErrors.push(...processResult.value.errors);
      }

      return ok({
        processed: totalProcessed,
        processingErrors: allErrors,
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
