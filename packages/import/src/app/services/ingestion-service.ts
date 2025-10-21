import { getErrorMessage } from '@exitbook/core';
import type { ExternalTransactionData, ImportSessionMetadata, UniversalTransaction } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import { PartialImportError } from '@exitbook/exchanges';
import type { ImportParams } from '@exitbook/import/app/ports/importers.ts';
import type { Logger } from '@exitbook/shared-logger';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, Result } from 'neverthrow';

import type { ImportResult } from '../../index.js';
import type { IDataSourceRepository } from '../ports/data-source-repository.interface.ts';
import type { IImporterFactory } from '../ports/importer-factory.interface.ts';
import type { IProcessorFactory } from '../ports/processor-factory.js';
import type { IRawDataRepository, LoadRawDataFilters } from '../ports/raw-data-repository.js';
import type { ProcessResult } from '../ports/transaction-processor.interface.ts';

/**
 * Manages the ETL pipeline for cryptocurrency transaction data.
 * Handles the Import → Process → Load workflow with proper error handling
 * and dependency injection.
 */
export class TransactionIngestionService {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private sessionRepository: IDataSourceRepository,
    private transactionRepository: ITransactionRepository,
    private importerFactory: IImporterFactory,
    private processorFactory: IProcessorFactory
  ) {
    this.logger = getLogger('TransactionIngestionService');
  }

  /**
   * Get processing status summary for a source.
   */
  async getProcessingStatus(sourceId: string): Promise<
    Result<
      {
        failed: number;
        pending: number;
        processed: number;
        total: number;
      },
      Error
    >
  > {
    const results = await Promise.all([
      this.rawDataRepository.load({
        processingStatus: 'pending',
        sourceId: sourceId,
      }),
      this.rawDataRepository.load({
        processingStatus: 'processed',
        sourceId: sourceId,
      }),
      this.rawDataRepository.load({
        processingStatus: 'failed',
        sourceId: sourceId,
      }),
    ]);

    return Result.combine(results).map(([pending, processedItems, failedItems]) => ({
      failed: failedItems.length,
      pending: pending.length,
      processed: processedItems.length,
      total: pending.length + processedItems.length + failedItems.length,
    }));
  }

  /**
   * Import raw data from source and store it in external_transaction_data table.
   * Delegates to exchange or blockchain specific import logic.
   */
  async importFromSource(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    params: ImportParams
  ): Promise<Result<ImportResult, Error>> {
    if (sourceType === 'exchange') {
      return this.importFromExchange(sourceId, params);
    } else {
      return this.importFromBlockchain(sourceId, params as ImportParams & { since?: number; until?: number });
    }
  }

  /**
   * Process raw data from storage into UniversalTransaction format and save to database.
   */
  async processRawDataToTransactions(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    filters?: LoadRawDataFilters
  ): Promise<Result<ProcessResult, Error>> {
    this.logger.info(`Starting processing for ${sourceId} (${sourceType})`);

    try {
      const loadFilters: LoadRawDataFilters = {
        processingStatus: 'pending',
        sourceId: sourceId,
        ...filters,
      };

      const rawDataItemsResult = await this.rawDataRepository.load(loadFilters);

      if (rawDataItemsResult.isErr()) {
        return err(rawDataItemsResult.error);
      }
      const rawDataItems = rawDataItemsResult.value;

      if (rawDataItems.length === 0) {
        this.logger.warn(`No pending raw data found for processing: ${sourceId}`);
        return ok({ errors: [], failed: 0, processed: 0 });
      }

      this.logger.info(`Found ${rawDataItems.length} raw data items to process for ${sourceId}`);

      const allSessionsResult = await this.sessionRepository.findBySource(sourceId);

      if (allSessionsResult.isErr()) {
        return err(allSessionsResult.error);
      }
      const allSessions = allSessionsResult.value;

      this.logger.debug(
        `Found ${allSessions.length} total sessions for source: ${allSessions.map((s) => s.id).join(', ')}`
      );

      const rawDataBySessionId = new Map<number, ExternalTransactionData[]>();

      for (const rawDataItem of rawDataItems) {
        if (rawDataItem.dataSourceId) {
          const sessionRawData = rawDataBySessionId.get(rawDataItem.dataSourceId) || [];
          sessionRawData.push(rawDataItem);
          rawDataBySessionId.set(rawDataItem.dataSourceId, sessionRawData);
        }
      }

      this.logger.debug(
        `Grouped raw data by session: ${Array.from(rawDataBySessionId.entries())
          .map(([sessionId, items]) => `Session ${sessionId}: ${items.length} items`)
          .join(', ')}`
      );

      const sessionsToProcess = allSessions
        .filter((session) => rawDataBySessionId.has(session.id))
        .map((session) => ({
          rawDataItems: rawDataBySessionId.get(session.id) || [],
          session,
        }))
        .filter((sessionData) =>
          sessionData.rawDataItems.some(
            (item) =>
              item.processingStatus === 'pending' &&
              (!filters?.importSessionId || item.dataSourceId === filters.importSessionId)
          )
        );

      this.logger.debug(
        `Sessions after filtering: ${sessionsToProcess.map((s) => `Session ${s.session.id} (${s.rawDataItems.length} items)`).join(', ')}`
      );

      this.logger.info(`Processing ${sessionsToProcess.length} sessions with pending raw data`);

      const allTransactions: (UniversalTransaction & { sessionId: number })[] = [];

      for (const sessionData of sessionsToProcess) {
        const { rawDataItems: sessionRawItems, session } = sessionData;

        const pendingItems = sessionRawItems.filter((item) => item.processingStatus === 'pending');

        if (pendingItems.length === 0) {
          continue;
        }

        const normalizedRawDataItems: unknown[] = [];

        // Use already-parsed fields from domain model
        const parsedSessionMetadata: ImportSessionMetadata = {
          ...session.importParams,
          ...session.importResultMetadata,
        };

        for (const item of pendingItems) {
          let normalizedData: unknown = item.normalizedData;

          if (!normalizedData || Object.keys(normalizedData as Record<string, never>).length === 0) {
            normalizedData = item.rawData;
          }

          // For exchanges: package both raw and normalized data (supports strategy pattern)
          // Raw contains CCXT-specific fields, normalized contains common ExchangeLedgerEntry fields
          // For blockchains: just use normalized data (already in final provider-specific format)
          if (sourceType === 'exchange') {
            const dataPackage = {
              raw: item.rawData,
              normalized: normalizedData,
              externalId: item.externalId || '',
              cursor: item.cursor || {},
            };

            normalizedRawDataItems.push(dataPackage);
          } else {
            // Blockchain: pass normalized data directly
            normalizedRawDataItems.push(normalizedData);
          }
        }

        const processor = await this.processorFactory.create(sourceId, sourceType, parsedSessionMetadata);

        const sessionTransactionsResult = await processor.process(normalizedRawDataItems, parsedSessionMetadata);

        if (sessionTransactionsResult.isErr()) {
          this.logger.error(
            `CRITICAL: Processing failed for session ${session.id} - ${sessionTransactionsResult.error}`
          );
          return err(
            new Error(
              `Cannot proceed: Session ${session.id} processing failed. ${sessionTransactionsResult.error}. ` +
                `This would corrupt portfolio calculations by losing transactions from this data source .`
            )
          );
        }

        const sessionTransactions = sessionTransactionsResult.value;
        allTransactions.push(...sessionTransactions.map((tx) => ({ ...tx, sessionId: session.id })));

        this.logger.debug(`Processed ${sessionTransactions.length} transactions for session ${session.id}`);
      }

      const transactions = allTransactions;

      const saveResults = await Promise.all(
        transactions.map((transaction) => this.transactionRepository.save(transaction, transaction.sessionId))
      );

      const combinedResult = Result.combineWithAllErrors(saveResults);
      if (combinedResult.isErr()) {
        const errors = combinedResult.error;
        const failed = errors.length;
        const errorMessages = errors.map((err, index) => {
          const transaction = transactions[index];
          const txId = transaction?.id ?? `index-${index}`;
          return `Transaction ${txId}: ${err.message}`;
        });

        this.logger.error(
          `CRITICAL: ${failed}/${transactions.length} transactions failed to save:\n${errorMessages.map((msg, i) => `  ${i + 1}. ${msg}`).join('\n')}`
        );

        return err(
          new Error(
            `Cannot proceed: ${failed}/${transactions.length} transactions failed to save to database. ` +
              `This would corrupt portfolio calculations. Errors: ${errorMessages.join('; ')}`
          )
        );
      }

      const savedCount = combinedResult.value.length;

      const allProcessedItems = sessionsToProcess.flatMap((sessionData) =>
        sessionData.rawDataItems.filter((item) => item.processingStatus === 'pending')
      );
      const allRawDataIds = allProcessedItems.map((item) => item.id);

      const markAsProcessedResult = await this.rawDataRepository.markAsProcessed(sourceId, allRawDataIds);

      if (markAsProcessedResult.isErr()) {
        return err(markAsProcessedResult.error);
      }

      const skippedCount = allProcessedItems.length - transactions.length;
      if (skippedCount > 0) {
        this.logger.info(`${skippedCount} items were processed but skipped (likely non-standard operation types)`);
      }

      this.logger.info(`Processing completed for ${sourceId}: ${savedCount} processed successfully`);

      return ok({
        errors: [],
        failed: 0,
        processed: savedCount,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`CRITICAL: Unexpected processing failure for ${sourceId}: ${errorMessage}`);
      return err(new Error(`Unexpected processing failure for ${sourceId}: ${errorMessage}`));
    }
  }

  /**
   * Import raw data from blockchain and store it in external_transaction_data table.
   */
  private async importFromBlockchain(
    sourceId: string,
    params: ImportParams & { since?: number; until?: number }
  ): Promise<Result<ImportResult, Error>> {
    const sourceType = 'blockchain';
    this.logger.info(`Starting blockchain import for ${sourceId}`);

    const existingSessionResult = await this.sessionRepository.findCompletedWithMatchingParams(sourceId, sourceType, {
      address: params.address,
      csvDirectories: params.csvDirectories,
      providerId: params.providerId,
    });

    if (existingSessionResult.isErr()) {
      return err(existingSessionResult.error);
    }

    const existingSession = existingSessionResult.value;

    if (existingSession) {
      this.logger.info(
        `Found existing completed data source  ${existingSession.id} with matching parameters - reusing data`
      );

      // Load raw data count from existing session
      const rawDataResult = await this.rawDataRepository.load({
        importSessionId: existingSession.id,
      });

      if (rawDataResult.isErr()) {
        return err(rawDataResult.error);
      }

      const rawDataCount = rawDataResult.value.length;

      return ok({
        imported: rawDataCount,
        importSessionId: existingSession.id,
      });
    }

    const startTime = Date.now();
    let sessionCreated = false;
    let importSessionId = 0;
    try {
      const sessionIdResult = await this.sessionRepository.create(sourceId, sourceType, params);

      if (sessionIdResult.isErr()) {
        return err(sessionIdResult.error);
      }

      importSessionId = sessionIdResult.value;
      sessionCreated = true;
      this.logger.info(`Created data source : ${importSessionId}`);

      const importer = await this.importerFactory.create(sourceId, sourceType, params);

      if (!importer) {
        return err(new Error(`No importer found for blockchain ${sourceId}`));
      }
      this.logger.info(`Importer for ${sourceId} created successfully`);

      this.logger.info('Starting raw data import...');
      const importResultOrError = await importer.import(params);

      if (importResultOrError.isErr()) {
        return err(importResultOrError.error);
      }

      const importResult = importResultOrError.value;
      const rawData = importResult.rawTransactions;

      const savedCountResult = await this.rawDataRepository.saveBatch(importSessionId, rawData);

      if (savedCountResult.isErr()) {
        return err(savedCountResult.error);
      }
      const savedCount = savedCountResult.value;

      // Finalize session with success and import result metadata
      if (sessionCreated && typeof importSessionId === 'number') {
        this.logger.debug(`Finalizing session ${importSessionId} with ${savedCount} transactions`);
        const finalizeResult = await this.sessionRepository.finalize(
          importSessionId,
          'completed',
          startTime,
          undefined,
          undefined,
          importResult.metadata
        );

        if (finalizeResult.isErr()) {
          return err(finalizeResult.error);
        }

        this.logger.debug(`Successfully finalized session ${importSessionId}`);
      }

      this.logger.info(`Import completed for ${sourceId}: ${savedCount} items saved`);

      return ok({
        imported: savedCount,
        importSessionId,
      });
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      if (sessionCreated && typeof importSessionId === 'number' && importSessionId > 0) {
        const finalizeResult = await this.sessionRepository.finalize(
          importSessionId,
          'failed',
          startTime,
          originalError.message,
          error instanceof Error ? { stack: error.stack } : { error: String(error) }
        );

        if (finalizeResult.isErr()) {
          this.logger.error(`Failed to update session on error: ${finalizeResult.error.message}`);
          return err(
            new Error(
              `Import failed: ${originalError.message}. Additionally, failed to update session: ${finalizeResult.error.message}`
            )
          );
        }
      }

      this.logger.error(`Import failed for ${sourceId}: ${originalError.message}`);
      return err(originalError);
    }
  }

  /**
   * Import raw data from exchange and store it in external_transaction_data table.
   * Handles validation errors by saving successful items and recording errors.
   * Supports resumption using per-operation-type cursors.
   */
  private async importFromExchange(sourceId: string, params: ImportParams): Promise<Result<ImportResult, Error>> {
    const sourceType = 'exchange';
    this.logger.info(`Starting exchange import for ${sourceId}`);

    const existingSessionsResult = await this.sessionRepository.findBySource(sourceId);

    if (existingSessionsResult.isErr()) {
      return err(existingSessionsResult.error);
    }

    const existingSession = existingSessionsResult.value[0];

    const startTime = Date.now();
    let sessionCreated = false;
    let importSessionId: number;

    if (existingSession) {
      importSessionId = existingSession.id;
      this.logger.info(`Resuming existing data source : ${importSessionId}`);

      const latestCursorResult = await this.rawDataRepository.getLatestCursor(importSessionId);
      if (latestCursorResult.isOk() && latestCursorResult.value) {
        const latestCursor = latestCursorResult.value;
        params.cursor = latestCursor;
        this.logger.info(`Resuming from cursor: ${JSON.stringify(latestCursor)}`);
      }
    } else {
      const sessionIdResult = await this.sessionRepository.create(sourceId, sourceType, params);

      if (sessionIdResult.isErr()) {
        return err(sessionIdResult.error);
      }

      importSessionId = sessionIdResult.value;
      sessionCreated = true;
      this.logger.info(`Created new data source : ${importSessionId}`);
    }

    try {
      const importer = await this.importerFactory.create(sourceId, sourceType, params);

      if (!importer) {
        return err(new Error(`No importer found for exchange ${sourceId}`));
      }
      this.logger.info(`Importer for ${sourceId} created successfully`);

      this.logger.info('Starting raw data import...');
      const importResultOrError = await importer.import(params);

      if (importResultOrError.isErr()) {
        const error = importResultOrError.error;

        if (error instanceof PartialImportError) {
          this.logger.warn(
            `Validation failed after ${error.successfulItems.length} successful items: ${error.message}`
          );

          let savedCount = 0;
          if (error.successfulItems.length > 0) {
            const saveResult = await this.rawDataRepository.saveBatch(importSessionId, error.successfulItems);

            if (saveResult.isErr()) {
              this.logger.error(`Failed to save successful items: ${saveResult.error.message}`);
            } else {
              savedCount = saveResult.value;
              this.logger.info(`Saved ${savedCount} successful items before validation error`);
            }
          }

          const finalizeResult = await this.sessionRepository.finalize(
            importSessionId,
            'failed',
            startTime,
            error.message,
            {
              failedItem: error.failedItem,
              lastSuccessfulCursor: error.lastSuccessfulCursor,
            }
          );

          if (finalizeResult.isErr()) {
            this.logger.error(`Failed to finalize session: ${finalizeResult.error.message}`);
          }

          return err(
            new Error(
              `Validation failed after ${savedCount} successful items: ${error.message}. ` +
                `Please fix the code to handle this data format, then re-import to resume from the last successful transaction.`
            )
          );
        }

        return err(error);
      }

      const importResult = importResultOrError.value;
      const rawData = importResult.rawTransactions;

      const savedCountResult = await this.rawDataRepository.saveBatch(importSessionId, rawData);

      if (savedCountResult.isErr()) {
        return err(savedCountResult.error);
      }
      const savedCount = savedCountResult.value;

      const finalizeResult = await this.sessionRepository.finalize(
        importSessionId,
        'completed',
        startTime,
        undefined,
        undefined,
        importResult.metadata
      );

      if (finalizeResult.isErr()) {
        return err(finalizeResult.error);
      }

      this.logger.info(`Import completed for ${sourceId}: ${savedCount} items saved`);

      return ok({
        imported: savedCount,
        importSessionId,
      });
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      if (sessionCreated && typeof importSessionId === 'number' && importSessionId > 0) {
        const finalizeResult = await this.sessionRepository.finalize(
          importSessionId,
          'failed',
          startTime,
          originalError.message,
          error instanceof Error ? { stack: error.stack } : { error: String(error) }
        );

        if (finalizeResult.isErr()) {
          this.logger.error(`Failed to update session on error: ${finalizeResult.error.message}`);
          return err(
            new Error(
              `Import failed: ${originalError.message}. Additionally, failed to update session: ${finalizeResult.error.message}`
            )
          );
        }
      }

      this.logger.error(`Import failed for ${sourceId}: ${originalError.message}`);
      return err(originalError);
    }
  }
}
