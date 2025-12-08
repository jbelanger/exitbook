import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, ImportSession, SourceType } from '@exitbook/core';
import type { AccountRepository, IImportSessionRepository, IRawDataRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { progress } from '@exitbook/ui';
import type { Result } from 'neverthrow';
import { err, ok, okAsync } from 'neverthrow';

import { getBlockchainAdapter } from '../infrastructure/blockchains/index.js';
import { createExchangeImporter } from '../infrastructure/exchanges/shared/exchange-importer-factory.js';
import type { IImporter, ImportParams } from '../types/importers.js';

import { normalizeBlockchainImportParams } from './import-service-utils.js';

export class TransactionImportService {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private importSessionRepository: IImportSessionRepository,
    private accountRepository: AccountRepository,
    private providerManager: BlockchainProviderManager
  ) {
    this.logger = getLogger('TransactionImportService');
  }

  /**
   * Import raw data from source and store it in external_transaction_data table.
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
   * Setup import by creating importer and normalizing params based on source type
   */
  private async setupImport(account: Account): Promise<Result<{ importer: IImporter; params: ImportParams }, Error>> {
    const sourceType = deriveSourceType(account.accountType);

    if (sourceType === 'blockchain') {
      return this.setupBlockchainImport(account);
    } else {
      return this.setupExchangeImport(account);
    }
  }

  /**
   * Setup blockchain import - normalize address and create importer
   */
  private async setupBlockchainImport(
    account: Account
  ): Promise<Result<{ importer: IImporter; params: ImportParams }, Error>> {
    const sourceName = account.sourceName;
    this.logger.info(`Setting up blockchain import for ${sourceName}`);

    // Normalize sourceName to lowercase for config lookup (registry keys are lowercase)
    const normalizedSourceName = sourceName.toLowerCase();

    // Get blockchain adapter
    const adapter = getBlockchainAdapter(normalizedSourceName);
    if (!adapter) {
      return err(new Error(`Unknown blockchain: ${sourceName}`));
    }

    // Build ImportParams from account
    const params: ImportParams = {
      address: account.identifier,
      providerName: account.providerName ?? undefined,
      cursor: account.lastCursor,
    };

    // Normalize and validate params using pure function
    const normalizedParamsResult = normalizeBlockchainImportParams(sourceName, params, adapter);
    if (normalizedParamsResult.isErr()) {
      return err(normalizedParamsResult.error);
    }
    const normalizedParams = normalizedParamsResult.value;

    // Create importer with resume cursor from account (single source of truth)
    const importParams: ImportParams = {
      ...normalizedParams,
      cursor: account.lastCursor,
    };

    const importer = adapter.createImporter(this.providerManager, normalizedParams.providerName);
    this.logger.info(`Importer for ${sourceName} created successfully`);

    // Check if importer supports streaming
    if (!importer.importStreaming) {
      return err(new Error(`Importer for ${sourceName} does not support streaming yet`));
    }

    return okAsync({ importer, params: importParams });
  }

  /**
   * Setup exchange import - handle credentials/CSV and create importer
   */
  private async setupExchangeImport(
    account: Account
  ): Promise<Result<{ importer: IImporter; params: ImportParams }, Error>> {
    const sourceName = account.sourceName;
    this.logger.info(`Setting up exchange import for ${sourceName}`);

    // Build ImportParams from account
    const params: ImportParams = {};

    if (account.accountType === 'exchange-api') {
      // For API accounts, use credentials
      params.credentials = account.credentials ?? undefined;
    } else if (account.accountType === 'exchange-csv') {
      // For CSV accounts, parse identifier as comma-separated directories
      params.csvDirectories = account.identifier.split(',');
    }

    // Add cursor if available
    if (account.lastCursor) {
      params.cursor = account.lastCursor;
    }

    // Create importer
    const importerResult = await createExchangeImporter(sourceName);

    if (importerResult.isErr()) {
      return err(importerResult.error);
    }

    const importer = importerResult.value;
    this.logger.info(`Importer for ${sourceName} created successfully`);

    // Check if importer supports streaming
    if (!importer.importStreaming) {
      return err(new Error(`Importer for ${sourceName} does not support streaming`));
    }

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
      this.logger.info(`Starting new import with import session #${importSessionId}`);
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
        progress.update(`Saving ${batch.rawTransactions.length} ${batch.operationType} transactions...`);
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

      this.logger.info(
        `Import completed for ${sourceName}: ${totalImported} items saved, ${totalSkipped} duplicates skipped`
      );

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

/**
 * Derive SourceType from AccountType
 */
function deriveSourceType(accountType: Account['accountType']): SourceType {
  if (accountType === 'blockchain') {
    return 'blockchain';
  }
  // Both exchange-api and exchange-csv map to 'exchange' source type
  return 'exchange';
}
