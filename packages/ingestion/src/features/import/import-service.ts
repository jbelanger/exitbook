import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, ImportSession } from '@exitbook/core';
import type { AccountRepository, IImportSessionRepository, IRawDataRepository } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { ImportEvent } from '../../events.js';
import { getBlockchainAdapter } from '../../shared/types/blockchain-adapter.js';
import { getExchangeAdapter } from '../../shared/types/exchange-adapter.js';
import type { IImporter, ImportParams } from '../../shared/types/importers.js';

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
    private providerManager: BlockchainProviderManager,
    private eventBus?: EventBus<ImportEvent> | undefined
  ) {
    this.logger = getLogger('ImportExecutor');
  }

  /**
   * Import raw data from source and store it in raw_transactions table.
   * Uses streaming with crash recovery for all sources (blockchain and exchange).
   * All parameters are extracted from the account object.
   */
  async importFromSource(account: Account): Promise<Result<ImportSession, Error>> {
    const setupResult = this.setupImport(account);
    if (setupResult.isErr()) return err(setupResult.error);

    const { importer, params } = setupResult.value;
    return this.executeStreamingImport(account, importer, params);
  }

  /**
   * Setup import by creating importer and extracting params from account.
   * No rebuilding or normalization needed - Account stores canonical params.
   */
  private setupImport(account: Account): Result<{ importer: IImporter; params: ImportParams }, Error> {
    const sourceName = account.sourceName;
    const sourceType = account.accountType;

    this.logger.debug(`Setting up ${sourceType} import for ${sourceName}`);

    const params: ImportParams = {
      sourceName,
      sourceType,
      cursor: account.lastCursor,
    };

    if (sourceType === 'blockchain') {
      params.address = account.identifier;
      params.providerName = account.providerName ?? undefined;
      if (!params.address) {
        return err(new Error(`Address required for ${sourceName} import`));
      }
    } else if (sourceType === 'exchange-api') {
      params.credentials = account.credentials ?? undefined;
    } else if (sourceType === 'exchange-csv') {
      params.csvDirectory = account.identifier;
    }

    const normalizedSourceName = sourceName.toLowerCase();
    let importer: IImporter;

    if (sourceType === 'blockchain') {
      const adapter = getBlockchainAdapter(normalizedSourceName);
      if (!adapter) {
        return err(new Error(`Unknown blockchain: ${sourceName}`));
      }
      importer = adapter.createImporter(this.providerManager, params.providerName);
    } else {
      const adapter = getExchangeAdapter(normalizedSourceName);
      if (!adapter) {
        return err(new Error(`Unknown exchange: ${sourceName}`));
      }
      importer = adapter.createImporter();
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

    const incompleteImportSessionResult = await this.importSessionRepository.findLatestIncomplete(account.id);

    if (incompleteImportSessionResult.isErr()) {
      return err(incompleteImportSessionResult.error);
    }

    const incompleteImportSession = incompleteImportSessionResult.value;
    let importSessionId: number;
    let totalImported = 0;
    let totalSkipped = 0;
    let totalFetchedRun = 0;

    let resuming: boolean;

    if (incompleteImportSession) {
      importSessionId = incompleteImportSession.id;
      totalImported = incompleteImportSession.transactionsImported || 0;
      totalSkipped = incompleteImportSession.transactionsSkipped || 0;
      resuming = true;

      this.logger.info(
        `Resuming import from import session #${importSessionId} (total so far: ${totalImported} imported, ${totalSkipped} skipped)`
      );

      this.eventBus?.emit({
        type: 'import.session.resumed',
        sessionId: importSessionId,
        accountId: account.id,
        sourceName,
        fromCursor: account.lastCursor?.cursor?.primary.value ?? 0,
      });

      // Reset status to 'started' in case the previous attempt failed
      const updateResult = await this.importSessionRepository.update(importSessionId, { status: 'started' });
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }
    } else {
      const importSessionCreateResult = await this.importSessionRepository.create(account.id);
      if (importSessionCreateResult.isErr()) {
        return err(importSessionCreateResult.error);
      }

      importSessionId = importSessionCreateResult.value;
      resuming = false;

      this.logger.info(`Created new import session #${importSessionId}`);

      this.eventBus?.emit({
        type: 'import.session.created',
        sessionId: importSessionId,
        accountId: account.id,
        sourceName,
      });
    }

    this.eventBus?.emit({
      type: 'import.started',
      sourceName,
      sourceType: account.accountType,
      accountId: account.id,
      resuming,
      address: account.accountType === 'blockchain' ? account.identifier : undefined,
    });

    const startTime = Date.now();
    const allWarnings: string[] = [];

    try {
      const batchIterator = importer.importStreaming(params);

      for await (const batchResult of batchIterator) {
        if (batchResult.isErr()) {
          await this.importSessionRepository.update(importSessionId, {
            status: 'failed',
            error_message: batchResult.error.message,
          });
          return err(batchResult.error);
        }

        const batch = batchResult.value;

        if (batch.warnings && batch.warnings.length > 0) {
          allWarnings.push(...batch.warnings);
          for (const warning of batch.warnings) {
            this.logger.warn(`⚠️  Import warning: ${warning}`);
            this.eventBus?.emit({
              type: 'import.warning',
              sourceName,
              accountId: account.id,
              streamType: batch.streamType,
              warning,
            });
          }
        }

        this.logger.debug(`Saving ${batch.rawTransactions.length} ${batch.streamType}...`);
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
        totalFetchedRun += batch.rawTransactions.length;

        if (skipped > 0) {
          this.logger.info(`Skipped ${skipped} duplicate transactions in batch`);
        }

        // Update progress and cursor after EACH batch for crash recovery
        const cursorUpdateResult = await this.accountRepository.updateCursor(
          account.id,
          batch.streamType,
          batch.cursor
        );

        if (cursorUpdateResult.isErr()) {
          this.logger.warn(`Failed to update cursor for ${batch.streamType}: ${cursorUpdateResult.error.message}`);
        }

        this.logger.info(
          `Batch saved: ${inserted} inserted, ${skipped} skipped of ${batch.rawTransactions.length} ${batch.streamType} (total: ${totalImported}, fetched this run: ${totalFetchedRun})`
        );

        this.eventBus?.emit({
          type: 'import.batch',
          sourceName,
          accountId: account.id,
          fetched: batch.rawTransactions.length, // Count before DB dedup
          deduplicated: batch.rawTransactions.length, // Already deduped by provider
          batchInserted: inserted,
          batchSkipped: skipped,
          totalImported,
          totalSkipped,
          streamType: batch.streamType,
          cursorProgress: batch.cursor.totalFetched,
          totalFetchedRun,
          isComplete: batch.isComplete,
        });

        if (batch.isComplete) {
          this.logger.debug(`Import for ${batch.streamType} marked complete by provider`);
        }
      }

      if (allWarnings.length > 0) {
        const warningMessage = `Import completed with ${allWarnings.length} warning(s) and was marked as failed to prevent processing incomplete data. `;

        const finalizeResult = await this.importSessionRepository.finalize(
          importSessionId,
          'failed',
          startTime,
          totalImported,
          totalSkipped,
          warningMessage,
          { warnings: allWarnings }
        );

        if (finalizeResult.isErr()) {
          return err(finalizeResult.error);
        }

        this.logger.warn(`⚠️  Import marked failed due to ${allWarnings.length} warning(s). Data may be incomplete.`);

        this.eventBus?.emit({
          type: 'import.failed',
          sourceName,
          accountId: account.id,
          error: warningMessage,
        });

        return err(new Error(warningMessage));
      }

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

      this.eventBus?.emit({
        type: 'import.completed',
        sourceName,
        accountId: account.id,
        totalImported,
        totalSkipped,
        durationMs: Date.now() - startTime,
      });

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

      this.eventBus?.emit({
        type: 'import.failed',
        sourceName,
        accountId: account.id,
        error: originalError.message,
      });

      return err(originalError);
    }
  }
}
