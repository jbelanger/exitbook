import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, ImportSession } from '@exitbook/core';
import { createAccountQueries, createImportSessionQueries, createRawDataQueries, type KyselyDB } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { ImportEvent } from '../../events.js';
import type { AdapterRegistry } from '../../shared/types/adapter-registry.js';
import type { IImporter, ImportParams } from '../../shared/types/importers.js';

/**
 * Internal service that executes imports for a given account.
 * Handles importer creation, streaming, crash recovery, and database persistence.
 * Not exported - use ImportOrchestrator as the public API.
 */
export class StreamingImportRunner {
  private logger: Logger;
  private rawDataQueries: ReturnType<typeof createRawDataQueries>;
  private importSessionQueries: ReturnType<typeof createImportSessionQueries>;
  private accountQueries: ReturnType<typeof createAccountQueries>;

  constructor(
    db: KyselyDB,
    private providerManager: BlockchainProviderManager,
    private registry: AdapterRegistry,
    private eventBus?: EventBus<ImportEvent> | undefined
  ) {
    this.logger = getLogger('StreamingImportRunner');
    this.rawDataQueries = createRawDataQueries(db);
    this.importSessionQueries = createImportSessionQueries(db);
    this.accountQueries = createAccountQueries(db);
  }

  /**
   * Import raw data from source and store it in raw_transactions table.
   * Uses streaming with crash recovery for all sources (blockchain and exchange).
   * All parameters are extracted from the account object.
   */
  async importFromSource(account: Account): Promise<Result<ImportSession, Error>> {
    const setupResult = this.buildImporter(account);
    if (setupResult.isErr()) return err(setupResult.error);

    const { importer, params } = setupResult.value;
    return this.executeStreamingImport(account, importer, params);
  }

  /**
   * Setup import by creating importer and extracting params from account.
   * No rebuilding or normalization needed - Account stores canonical params.
   */
  private buildImporter(account: Account): Result<{ importer: IImporter; params: ImportParams }, Error> {
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
      const adapterResult = this.registry.getBlockchain(normalizedSourceName);
      if (adapterResult.isErr()) {
        return err(adapterResult.error);
      }
      importer = adapterResult.value.createImporter(this.providerManager, params.providerName);
    } else {
      const adapterResult = this.registry.getExchange(normalizedSourceName);
      if (adapterResult.isErr()) {
        return err(adapterResult.error);
      }
      importer = adapterResult.value.createImporter();
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

    const incompleteImportSessionResult = await this.importSessionQueries.findLatestIncomplete(account.id);

    if (incompleteImportSessionResult.isErr()) {
      return err(incompleteImportSessionResult.error);
    }

    const incompleteImportSession = incompleteImportSessionResult.value;
    let importSessionId: number;
    let totalImported = 0;
    let totalSkipped = 0;
    let totalFetchedRun = 0;

    if (incompleteImportSession) {
      importSessionId = incompleteImportSession.id;
      totalImported = incompleteImportSession.transactionsImported || 0;
      totalSkipped = incompleteImportSession.transactionsSkipped || 0;

      this.logger.info(
        `Resuming import from import session #${importSessionId} (total so far: ${totalImported} imported, ${totalSkipped} skipped)`
      );

      // Reset status to 'started' in case the previous attempt failed
      const updateResult = await this.importSessionQueries.update(importSessionId, { status: 'started' });
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }
    } else {
      const importSessionCreateResult = await this.importSessionQueries.create(account.id);
      if (importSessionCreateResult.isErr()) {
        return err(importSessionCreateResult.error);
      }

      importSessionId = importSessionCreateResult.value;

      this.logger.info(`Created new import session #${importSessionId}`);
    }

    const isNewAccount = account.lastCursor === null;

    // Fetch transaction counts by stream type for existing accounts
    let transactionCounts: Map<string, number> | undefined;
    let transactionCountWarning: string | undefined;
    if (!isNewAccount) {
      const countsResult = await this.rawDataQueries.countByStreamType(account.id);
      if (countsResult.isOk()) {
        transactionCounts = countsResult.value;
      } else {
        transactionCountWarning = `Failed to fetch import stream counts for account ${account.id}: ${countsResult.error.message}`;
        this.logger.warn(
          { accountId: account.id, error: countsResult.error },
          'Failed to fetch import stream counts; continuing without transaction count metadata'
        );
      }
    }

    this.eventBus?.emit({
      type: 'import.started',
      sourceName,
      sourceType: account.accountType,
      accountId: account.id,
      parentAccountId: account.parentAccountId,
      isNewAccount,
      address: account.accountType === 'blockchain' ? account.identifier : undefined,
      transactionCounts,
    });

    if (transactionCountWarning) {
      this.eventBus?.emit({
        type: 'import.warning',
        sourceName,
        accountId: account.id,
        warning: transactionCountWarning,
      });
    }

    const startTime = Date.now();
    const allWarnings: string[] = [];

    try {
      const batchIterator = importer.importStreaming(params);

      for await (const batchResult of batchIterator) {
        if (batchResult.isErr()) {
          await this.importSessionQueries.update(importSessionId, {
            status: 'failed',
            error_message: batchResult.error.message,
          });
          return err(batchResult.error);
        }

        const batch = batchResult.value;
        const fetchedInBatch = batch.providerStats?.fetched ?? batch.rawTransactions.length;
        const deduplicatedInBatch = batch.providerStats?.deduplicated ?? 0;

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
        const saveResult = await this.rawDataQueries.saveBatch(account.id, batch.rawTransactions);

        if (saveResult.isErr()) {
          await this.importSessionQueries.update(importSessionId, {
            status: 'failed',
            error_message: saveResult.error.message,
          });
          return err(saveResult.error);
        }

        const { inserted, skipped } = saveResult.value;
        totalImported += inserted;
        totalSkipped += skipped;
        totalFetchedRun += fetchedInBatch;

        if (skipped > 0) {
          this.logger.info(`Skipped ${skipped} duplicate transactions in batch`);
        }

        // Update progress and cursor after EACH batch for crash recovery
        const cursorUpdateResult = await this.accountQueries.updateCursor(account.id, batch.streamType, batch.cursor);

        if (cursorUpdateResult.isErr()) {
          const warning = `Failed to update cursor for account ${account.id} (${batch.streamType}): ${cursorUpdateResult.error.message}`;
          this.logger.warn(
            {
              accountId: account.id,
              streamType: batch.streamType,
              error: cursorUpdateResult.error,
            },
            'Failed to update cursor after saving batch; continuing import with dedup protection on resume'
          );
          this.eventBus?.emit({
            type: 'import.warning',
            sourceName,
            accountId: account.id,
            streamType: batch.streamType,
            warning,
          });
        }

        this.logger.info(
          `Batch saved: ${inserted} inserted, ${skipped} skipped of ${batch.rawTransactions.length} ${batch.streamType} (${fetchedInBatch} fetched, ${deduplicatedInBatch} deduplicated by provider, total fetched this run: ${totalFetchedRun})`
        );

        this.eventBus?.emit({
          type: 'import.batch',
          sourceName,
          accountId: account.id,
          fetched: fetchedInBatch,
          deduplicated: deduplicatedInBatch,
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

        const finalizeResult = await this.importSessionQueries.finalize(
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

      const finalizeResult = await this.importSessionQueries.finalize(
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

      const sessionResult = await this.importSessionQueries.findById(importSessionId);
      if (sessionResult.isErr()) {
        return err(sessionResult.error);
      }
      if (!sessionResult.value) {
        return err(new Error(`Import session #${importSessionId} not found after finalization`));
      }

      return ok(sessionResult.value);
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      await this.importSessionQueries.finalize(
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
