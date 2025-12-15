import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, ImportSession } from '@exitbook/core';
import type { AccountRepository, IImportSessionRepository, IRawDataRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { createExchangeImporter } from '../../sources/exchanges/shared/exchange-importer-factory.ts';
import { getBlockchainAdapter } from '../types/blockchain-adapter.ts';
import type { IImporter, ImportParams } from '../types/importers.ts';

/**
 * Internal service that executes imports for a given account.
 * Handles importer creation, streaming, crash recovery, and database persistence.
 * Not exported - use ImportOrchestrator as the public API.
 */
export class ImportExecutor {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private importSessionRepository: IImportSessionRepository,
    private accountRepository: AccountRepository,
    private providerManager: BlockchainProviderManager
  ) {
    this.logger = getLogger('ImportExecutor');
  }

  /**
   * Import raw data from source and store it in raw_transactions table.
   * Uses streaming with crash recovery for all sources (blockchain and exchange).
   * All parameters are extracted from the account object.
   */
  async importFromSource(account: Account): Promise<Result<ImportSession, Error>> {
    // Get importer and params based on source type
    const setupResult = await this.setupImport(account);
    if (setupResult.isErr()) return err(setupResult.error);

    const { importer, params } = setupResult.value;

    // Execute unified streaming import
    return this.executeStreamingImport(account, importer, params);
  }

  /**
   * Setup import by creating importer and extracting params from account.
   * No rebuilding or normalization needed - Account stores canonical params.
   */
  private async setupImport(account: Account): Promise<Result<{ importer: IImporter; params: ImportParams }, Error>> {
    const sourceName = account.sourceName;
    const sourceType = account.accountType;

    this.logger.debug(`Setting up ${sourceType} import for ${sourceName}`);

    // Extract params directly from account - no normalization needed
    const params: ImportParams = {
      sourceName,
      sourceType,
      cursor: account.lastCursor,
    };

    // Add source-specific fields based on account type
    if (sourceType === 'blockchain') {
      params.address = account.identifier;
      params.providerName = account.providerName ?? undefined;

      // Validate address is provided
      if (!params.address) {
        return err(new Error(`Address required for ${sourceName} import`));
      }
    } else if (sourceType === 'exchange-api') {
      params.credentials = account.credentials ?? undefined;
    } else if (sourceType === 'exchange-csv') {
      params.csvDirectory = account.identifier;
    }

    // Create importer based on source type
    let importer: IImporter;

    if (sourceType === 'blockchain') {
      const normalizedSourceName = sourceName.toLowerCase();
      const adapter = getBlockchainAdapter(normalizedSourceName);
      if (!adapter) {
        return err(new Error(`Unknown blockchain: ${sourceName}`));
      }
      importer = adapter.createImporter(this.providerManager, params.providerName);
    } else {
      const importerResult = await createExchangeImporter(sourceName);
      if (importerResult.isErr()) {
        return err(importerResult.error);
      }
      importer = importerResult.value;
    }

    this.logger.debug(`Importer for ${sourceName} created successfully`);

    return ok({ importer, params });
  }

  /**
   * Execute streaming import for any source (blockchain or exchange).
   * Memory-bounded with crash recovery - saves cursor after each batch.
   */
  private async executeStreamingImport(
    account: Account,
    importer: IImporter,
    params: ImportParams
  ): Promise<Result<ImportSession, Error>> {
    const sourceName = account.sourceName;

    // Check for existing incomplete import session to resume
    const incompleteImportSessionResult = await this.importSessionRepository.findLatestIncomplete(account.id);

    if (incompleteImportSessionResult.isErr()) {
      return err(incompleteImportSessionResult.error);
    }

    const incompleteImportSession = incompleteImportSessionResult.value;
    let importSessionId: number;
    let totalImported = 0;
    let totalSkipped = 0;

    if (incompleteImportSession) {
      // Resume existing import - cursor comes from account.lastCursor
      importSessionId = incompleteImportSession.id;
      totalImported = incompleteImportSession.transactionsImported || 0;
      totalSkipped = incompleteImportSession.transactionsSkipped || 0;

      this.logger.info(
        `Resuming import from import session #${importSessionId} (total so far: ${totalImported} imported, ${totalSkipped} skipped)`
      );

      // Update status back to 'started' (in case it was 'failed')
      const updateResult = await this.importSessionRepository.update(importSessionId, { status: 'started' });
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }
    } else {
      // Create new import session for this account
      const importSessionCreateResult = await this.importSessionRepository.create(account.id);

      if (importSessionCreateResult.isErr()) {
        return err(importSessionCreateResult.error);
      }

      importSessionId = importSessionCreateResult.value;
      this.logger.info(`Created new import session #${importSessionId}`);
    }

    const startTime = Date.now();

    try {
      // Stream batches from importer
      const batchIterator = importer.importStreaming(params);

      for await (const batchResult of batchIterator) {
        if (batchResult.isErr()) {
          // Update import session with error
          await this.importSessionRepository.update(importSessionId, {
            status: 'failed',
            error_message: batchResult.error.message,
          });
          return err(batchResult.error);
        }

        const batch = batchResult.value;

        // Save batch to database
        this.logger.debug(`Saving ${batch.rawTransactions.length} ${batch.operationType} transactions...`);
        const saveResult = await this.rawDataRepository.saveBatch(account.id, batch.rawTransactions);

        if (saveResult.isErr()) {
          await this.importSessionRepository.update(importSessionId, {
            status: 'failed',
            error_message: saveResult.error.message,
          });
          return err(saveResult.error);
        }

        const { inserted, skipped } = saveResult.value;
        totalImported += inserted;
        totalSkipped += skipped;

        if (skipped > 0) {
          this.logger.info(`Skipped ${skipped} duplicate transactions in batch`);
        }

        // Update progress and cursor after EACH batch for crash recovery
        const cursorUpdateResult = await this.accountRepository.updateCursor(
          account.id,
          batch.operationType,
          batch.cursor
        );

        if (cursorUpdateResult.isErr()) {
          this.logger.warn(`Failed to update cursor for ${batch.operationType}: ${cursorUpdateResult.error.message}`);
          // Don't fail the import, just log warning
        }

        this.logger.info(
          `Batch saved: ${inserted} inserted, ${skipped} skipped of ${batch.rawTransactions.length} ${batch.operationType} transactions (total: ${totalImported}, cursor progress: ${batch.cursor.totalFetched})`
        );

        if (batch.isComplete) {
          this.logger.info(`Import for ${batch.operationType} marked complete by provider`);
        }
      }

      // Mark complete
      const finalizeResult = await this.importSessionRepository.finalize(
        importSessionId,
        'completed',
        startTime,
        totalImported,
        totalSkipped
      );

      if (finalizeResult.isErr()) {
        return err(finalizeResult.error);
      }

      if (account.accountType === 'exchange-csv') {
        this.logger.info(`Import completed for ${sourceName}: ${totalImported} items saved`);
      } else {
        this.logger.info(
          `Import completed for ${sourceName}: ${totalImported} items saved, ${totalSkipped} duplicates skipped`
        );
      }

      // Fetch and return the complete ImportSession
      const sessionResult = await this.importSessionRepository.findById(importSessionId);
      if (sessionResult.isErr()) {
        return err(sessionResult.error);
      }
      if (!sessionResult.value) {
        return err(new Error(`Import session #${importSessionId} not found after finalization`));
      }

      return ok(sessionResult.value);
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      await this.importSessionRepository.finalize(
        importSessionId,
        'failed',
        startTime,
        totalImported,
        totalSkipped,
        originalError.message,
        error instanceof Error ? { stack: error.stack } : { error: String(error) }
      );

      this.logger.error(`Import failed for ${sourceName}: ${originalError.message}`);
      return err(originalError);
    }
  }
}
