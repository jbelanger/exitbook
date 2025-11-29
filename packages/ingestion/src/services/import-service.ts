import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { Account, CursorState, SourceType } from '@exitbook/core';
import type { AccountRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { progress } from '@exitbook/ui';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { getBlockchainConfig } from '../infrastructure/blockchains/index.js';
import { createExchangeImporter } from '../infrastructure/exchanges/shared/exchange-importer-factory.js';
import type { IImporter, ImportParams, ImportResult } from '../types/importers.js';
import type { IDataSourceRepository, IRawDataRepository } from '../types/repositories.js';

import { normalizeBlockchainImportParams, prepareImportSession } from './import-service-utils.js';

export class TransactionImportService {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private dataSourceRepository: IDataSourceRepository,
    private accountRepository: AccountRepository,
    private providerManager: BlockchainProviderManager
  ) {
    this.logger = getLogger('TransactionImportService');
  }

  /**
   * Import raw data from source and store it in external_transaction_data table.
   * Uses streaming for blockchains (with crash recovery) and batch for exchanges.
   * All parameters are extracted from the account object.
   */
  async importFromSource(account: Account): Promise<Result<ImportResult, Error>> {
    const sourceType = deriveSourceType(account.accountType);

    if (sourceType === 'exchange') {
      return this.importFromExchange(account);
    } else {
      return this.importFromBlockchainStreaming(account);
    }
  }

  /**
   * Import raw data from blockchain using streaming with incremental persistence and crash recovery
   * Automatically resumes from incomplete imports
   */
  private async importFromBlockchainStreaming(account: Account): Promise<Result<ImportResult, Error>> {
    const sourceId = account.sourceName;
    this.logger.info(`Starting blockchain streaming import for ${sourceId}`);

    // Normalize sourceId to lowercase for config lookup (registry keys are lowercase)
    const normalizedSourceId = sourceId.toLowerCase();

    // Get blockchain config
    const config = getBlockchainConfig(normalizedSourceId);
    if (!config) {
      return err(new Error(`Unknown blockchain: ${sourceId}`));
    }

    // Build ImportParams from account
    const params: ImportParams = {
      address: account.identifier,
      providerName: account.providerName ?? undefined,
      cursor: account.lastCursor,
    };

    // Normalize and validate params using pure function
    const normalizedParamsResult = normalizeBlockchainImportParams(sourceId, params, config);
    if (normalizedParamsResult.isErr()) {
      return err(normalizedParamsResult.error);
    }
    const normalizedParams = normalizedParamsResult.value;

    // Check for existing incomplete data source to resume
    const incompleteDataSourceResult = await this.dataSourceRepository.findLatestIncomplete(account.id);

    if (incompleteDataSourceResult.isErr()) {
      return err(incompleteDataSourceResult.error);
    }

    const incompleteDataSource = incompleteDataSourceResult.value;
    let dataSourceId: number;
    let totalImported = 0;

    if (incompleteDataSource) {
      // Resume existing import - cursor comes from account.lastCursor
      dataSourceId = incompleteDataSource.id;
      totalImported = (incompleteDataSource.importResultMetadata?.transactionsImported as number) || 0;

      this.logger.info(`Resuming import from data source #${dataSourceId} (total so far: ${totalImported})`);

      // Update status back to 'started' (in case it was 'failed')
      const updateResult = await this.dataSourceRepository.update(dataSourceId, { status: 'started' });
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }
    } else {
      // Create new data source for this account
      const dataSourceCreateResult = await this.dataSourceRepository.create(account.id);

      if (dataSourceCreateResult.isErr()) {
        return err(dataSourceCreateResult.error);
      }

      dataSourceId = dataSourceCreateResult.value;
      this.logger.info(`Starting new import with data source #${dataSourceId}`);
    }

    const startTime = Date.now();

    try {
      // Create importer with resume cursor from account (single source of truth)
      const importParams: ImportParams = {
        ...normalizedParams,
        cursor: account.lastCursor,
      };

      const importer = config.createImporter(this.providerManager, normalizedParams.providerName);
      this.logger.info(`Importer for ${sourceId} created successfully`);

      // Check if importer supports streaming
      if (!importer.importStreaming) {
        return err(new Error(`Importer for ${sourceId} does not support streaming yet`));
      }

      // Stream batches from importer
      const batchIterator = importer.importStreaming(importParams);

      for await (const batchResult of batchIterator) {
        if (batchResult.isErr()) {
          // Update data source with error
          await this.dataSourceRepository.update(dataSourceId, {
            status: 'failed',
            error_message: batchResult.error.message,
          });
          return err(batchResult.error);
        }

        const batch = batchResult.value;

        // Save batch to database
        progress.update(`Saving ${batch.rawTransactions.length} ${batch.operationType} transactions...`);
        const saveResult = await this.rawDataRepository.saveBatch(dataSourceId, batch.rawTransactions);

        if (saveResult.isErr()) {
          await this.dataSourceRepository.update(dataSourceId, {
            status: 'failed',
            error_message: saveResult.error.message,
          });
          return err(saveResult.error);
        }

        totalImported += batch.rawTransactions.length;

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
          `Batch saved: ${batch.rawTransactions.length} ${batch.operationType} transactions (total: ${totalImported}, cursor progress: ${batch.cursor.totalFetched})`
        );

        if (batch.isComplete) {
          this.logger.info(`Import for ${batch.operationType} marked complete by provider`);
        }
      }

      // Mark complete
      const finalizeResult = await this.dataSourceRepository.finalize(
        dataSourceId,
        'completed',
        startTime,
        undefined,
        undefined,
        { transactionsImported: totalImported }
      );

      if (finalizeResult.isErr()) {
        return err(finalizeResult.error);
      }

      this.logger.info(`Import completed for ${sourceId}: ${totalImported} items saved`);

      return ok({
        imported: totalImported,
        dataSourceId,
      });
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      await this.dataSourceRepository.finalize(
        dataSourceId,
        'failed',
        startTime,
        originalError.message,
        error instanceof Error ? { stack: error.stack } : { error: String(error) }
      );

      this.logger.error(`Import failed for ${sourceId}: ${originalError.message}`);
      return err(originalError);
    }
  }

  /**
   * Import raw data from exchange and store it in external_transaction_data table.
   * Prefers streaming when available for better memory efficiency and crash recovery.
   * Falls back to legacy batch import for non-streaming importers.
   * Handles validation errors by saving successful items and recording errors.
   * Supports resumption using per-operation-type cursors.
   */
  private async importFromExchange(account: Account): Promise<Result<ImportResult, Error>> {
    const sourceName = account.sourceName;
    this.logger.info(`Starting exchange import for ${sourceName}`);

    // Check for latest incomplete data source to resume
    const existingDataSourceResult = await this.dataSourceRepository.findLatestIncomplete(account.id);
    if (existingDataSourceResult.isErr()) {
      return err(existingDataSourceResult.error);
    }
    const existingDataSource = existingDataSourceResult.value;

    // Get latest cursors from account (not data source)
    let latestCursors: Record<string, CursorState> | undefined = undefined;
    if (account.lastCursor) {
      latestCursors = account.lastCursor;
    }

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

    // Use pure function to prepare import session config
    const sessionConfig = prepareImportSession(sourceName, params, existingDataSource, latestCursors);

    // Create importer
    const importerResult = await createExchangeImporter(sourceName);

    if (importerResult.isErr()) {
      return err(importerResult.error);
    }

    const importer = importerResult.value;
    this.logger.info(`Importer for ${sourceName} created successfully`);

    return this.importFromExchangeStreaming(account, importer, sessionConfig.params);
  }

  /**
   * Streaming import for exchanges - memory-bounded with crash recovery
   */
  private async importFromExchangeStreaming(
    account: Account,
    importer: IImporter,
    params: ImportParams
  ): Promise<Result<ImportResult, Error>> {
    const sourceName = account.sourceName;

    // Check for existing incomplete data source to resume
    const incompleteDataSourceResult = await this.dataSourceRepository.findLatestIncomplete(account.id);

    if (incompleteDataSourceResult.isErr()) {
      return err(incompleteDataSourceResult.error);
    }

    const incompleteDataSource = incompleteDataSourceResult.value;
    let dataSourceId: number;
    let totalImported = 0;

    if (incompleteDataSource) {
      // Resume existing import - cursor comes from account.lastCursor
      dataSourceId = incompleteDataSource.id;
      totalImported = (incompleteDataSource.importResultMetadata?.transactionsImported as number) || 0;

      this.logger.info(`Resuming import from data source #${dataSourceId} (total so far: ${totalImported})`);

      // Update status back to 'started' (in case it was 'failed')
      const updateResult = await this.dataSourceRepository.update(dataSourceId, { status: 'started' });
      if (updateResult.isErr()) {
        return err(updateResult.error);
      }
    } else {
      // Create new data source for this account
      const dataSourceCreateResult = await this.dataSourceRepository.create(account.id);

      if (dataSourceCreateResult.isErr()) {
        return err(dataSourceCreateResult.error);
      }

      dataSourceId = dataSourceCreateResult.value;
      this.logger.info(`Starting new import with data source #${dataSourceId}`);
    }

    const startTime = Date.now();

    try {
      // Stream batches from importer - we've already checked importStreaming exists
      if (!importer.importStreaming) {
        return err(new Error(`Importer for ${sourceName} does not support streaming`));
      }
      const batchIterator = importer.importStreaming(params);

      for await (const batchResult of batchIterator) {
        if (batchResult.isErr()) {
          // Update data source with error
          await this.dataSourceRepository.update(dataSourceId, {
            status: 'failed',
            error_message: batchResult.error.message,
          });
          return err(batchResult.error);
        }

        const batch = batchResult.value;

        // Save batch to database
        progress.update(`Saving ${batch.rawTransactions.length} ${batch.operationType} transactions...`);
        const saveResult = await this.rawDataRepository.saveBatch(dataSourceId, batch.rawTransactions);

        if (saveResult.isErr()) {
          await this.dataSourceRepository.update(dataSourceId, {
            status: 'failed',
            error_message: saveResult.error.message,
          });
          return err(saveResult.error);
        }

        totalImported += batch.rawTransactions.length;

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
          `Batch saved: ${batch.rawTransactions.length} ${batch.operationType} transactions (total: ${totalImported}, cursor progress: ${batch.cursor.totalFetched})`
        );

        if (batch.isComplete) {
          this.logger.info(`Import for ${batch.operationType} marked complete by provider`);
        }
      }

      // Mark complete
      const finalizeResult = await this.dataSourceRepository.finalize(
        dataSourceId,
        'completed',
        startTime,
        undefined,
        undefined,
        { transactionsImported: totalImported }
      );

      if (finalizeResult.isErr()) {
        return err(finalizeResult.error);
      }

      this.logger.info(`Import completed for ${sourceName}: ${totalImported} items saved`);

      return ok({
        imported: totalImported,
        dataSourceId,
      });
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      await this.dataSourceRepository.finalize(
        dataSourceId,
        'failed',
        startTime,
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
