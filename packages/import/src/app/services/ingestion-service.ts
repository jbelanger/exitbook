import type { RawData, ImportSessionMetadata, RawTransactionMetadata, StoredImportParams } from '@exitbook/data';
import type { ImportParams } from '@exitbook/import/app/ports/importers.ts';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import type { IBlockchainNormalizer } from '@exitbook/providers';
import type { Logger } from '@exitbook/shared-logger';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, Result } from 'neverthrow';

import type { ImportResult } from '../../index.js';
import type { IImportSessionRepository } from '../ports/import-session-repository.interface.ts';
import type { IImporterFactory } from '../ports/importer-factory.interface.ts';
import type { IProcessorFactory } from '../ports/processor-factory.js';
import type { IRawDataRepository, LoadRawDataFilters } from '../ports/raw-data-repository.js';
import type { ProcessResult } from '../ports/transaction-processor.interface.ts';
import type { ITransactionRepository } from '../ports/transaction-repository.js';

/**
 * Manages the ETL pipeline for cryptocurrency transaction data.
 * Handles the Import → Process → Load workflow with proper error handling
 * and dependency injection.
 */
export class TransactionIngestionService {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private sessionRepository: IImportSessionRepository,
    private transactionRepository: ITransactionRepository,
    private importerFactory: IImporterFactory,
    private processorFactory: IProcessorFactory,
    private blockchainNormalizer: IBlockchainNormalizer
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
   */
  async importFromSource(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    params: ImportParams
  ): Promise<Result<ImportResult, Error>> {
    this.logger.info(`Starting import for ${sourceId} (${sourceType})`);

    // Check for existing completed session with matching parameters
    const existingSessionResult = await this.sessionRepository.findCompletedWithMatchingParams(sourceId, sourceType, {
      address: params.address,
      csvDirectories: params.csvDirectories,
      providerId: params.providerId,
      since: params.since,
    });

    if (existingSessionResult.isErr()) {
      return err(existingSessionResult.error);
    }

    const existingSession = existingSessionResult.value;

    if (existingSession) {
      this.logger.info(
        `Found existing completed import session ${existingSession.id} with matching parameters - reusing data`
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
      const sessionIdResult = await this.sessionRepository.create(sourceId, sourceType, params.providerId, params);

      if (sessionIdResult.isErr()) {
        return err(sessionIdResult.error);
      }

      importSessionId = sessionIdResult.value;
      sessionCreated = true;
      this.logger.info(`Created import session: ${importSessionId}`);

      const importer = await this.importerFactory.create(sourceId, sourceType, params.providerId);

      if (!importer) {
        return err(new Error(`No importer found for source ${sourceId} of type ${sourceType}`));
      }
      this.logger.info(`Importer for ${sourceId} created successfully`);

      // Import raw data
      this.logger.info('Starting raw data import...');
      const importResultOrError = await importer.import(params);

      if (importResultOrError.isErr()) {
        return err(importResultOrError.error);
      }

      const importResult = importResultOrError.value;
      const rawData = importResult.rawTransactions;

      // Save all raw data items to storage in a single transaction
      const savedCountResult = await this.rawDataRepository.saveBatch(
        rawData.map((element) => ({
          metadata: element.metadata,
          providerId: element.metadata.providerId,
          rawData: element.rawData,
        })),
        importSessionId
      );

      // Handle Result type - fail fast if save fails
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
          savedCount,
          0,
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

      // Update session with error if we created it
      if (sessionCreated && typeof importSessionId === 'number' && importSessionId > 0) {
        const finalizeResult = await this.sessionRepository.finalize(
          importSessionId,
          'failed',
          startTime,
          0,
          0,
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
   * Process raw data from storage into UniversalTransaction format and save to database.
   */
  async processRawDataToTransactions(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    filters?: LoadRawDataFilters
  ): Promise<Result<ProcessResult, Error>> {
    this.logger.info(`Starting processing for ${sourceId} (${sourceType})`);

    try {
      // Load raw data from storage
      const loadFilters: LoadRawDataFilters = {
        processingStatus: 'pending',
        sourceId: sourceId,
        ...filters,
      };

      const rawDataItemsResult = await this.rawDataRepository.load(loadFilters);

      // Handle Result type - fail fast if loading fails
      if (rawDataItemsResult.isErr()) {
        return err(rawDataItemsResult.error);
      }
      const rawDataItems = rawDataItemsResult.value;

      if (rawDataItems.length === 0) {
        this.logger.warn(`No pending raw data found for processing: ${sourceId}`);
        return ok({ errors: [], failed: 0, processed: 0 });
      }

      this.logger.info(`Found ${rawDataItems.length} raw data items to process for ${sourceId}`);

      // Fetch sessions and raw data separately
      const allSessionsResult = await this.sessionRepository.findBySource(sourceId);

      if (allSessionsResult.isErr()) {
        return err(allSessionsResult.error);
      }
      const allSessions = allSessionsResult.value;

      this.logger.debug(
        `Found ${allSessions.length} total sessions for source: ${allSessions.map((s) => s.id).join(', ')}`
      );

      // Get raw data items that match our filters (already loaded above)
      const rawDataBySessionId = new Map<number, RawData[]>();

      // Group raw data by session ID
      for (const rawDataItem of rawDataItems) {
        if (rawDataItem.import_session_id) {
          const sessionRawData = rawDataBySessionId.get(rawDataItem.import_session_id) || [];
          sessionRawData.push(rawDataItem);
          rawDataBySessionId.set(rawDataItem.import_session_id, sessionRawData);
        }
      }

      this.logger.debug(
        `Grouped raw data by session: ${Array.from(rawDataBySessionId.entries())
          .map(([sessionId, items]) => `Session ${sessionId}: ${items.length} items`)
          .join(', ')}`
      );

      // Create sessions with raw data structure, filtering to only sessions that have pending raw data
      const sessionsToProcess = allSessions
        .filter((session) => rawDataBySessionId.has(session.id))
        .map((session) => ({
          rawDataItems: rawDataBySessionId.get(session.id) || [],
          session,
        }))
        .filter((sessionData) =>
          sessionData.rawDataItems.some(
            (item) =>
              item.processing_status === 'pending' &&
              (!filters?.importSessionId || item.import_session_id === filters.importSessionId)
          )
        );

      this.logger.debug(
        `Sessions after filtering: ${sessionsToProcess.map((s) => `Session ${s.session.id} (${s.rawDataItems.length} items)`).join(', ')}`
      );

      this.logger.info(`Processing ${sessionsToProcess.length} sessions with pending raw data`);

      const allTransactions: (UniversalTransaction & { sessionId: number })[] = [];

      // Process each session with its raw data and metadata
      for (const sessionData of sessionsToProcess) {
        const { rawDataItems: sessionRawItems, session } = sessionData;

        // Filter to only pending items for this session
        const pendingItems = sessionRawItems.filter((item) => item.processing_status === 'pending');

        if (pendingItems.length === 0) {
          continue;
        }

        const normalizedRawDataItems: unknown[] = [];
        const normalizationErrors: { error: string; itemId: number }[] = [];
        const skippedItems: { itemId: number; reason: string }[] = [];

        const parsedImportParams =
          typeof session.import_params === 'string'
            ? (JSON.parse(session.import_params) as StoredImportParams)
            : (session.import_params as StoredImportParams);
        const parsedResultMetadata =
          typeof session.import_result_metadata === 'string'
            ? (JSON.parse(session.import_result_metadata) as Record<string, unknown>)
            : (session.import_result_metadata as Record<string, unknown>);

        if (sourceType === 'blockchain') {
          const normalizer = this.blockchainNormalizer;
          if (normalizer) {
            for (const item of pendingItems) {
              // Parse JSON strings from database
              const parsedMetadata: RawTransactionMetadata =
                typeof item.metadata === 'string'
                  ? (JSON.parse(item.metadata) as RawTransactionMetadata)
                  : (item.metadata as RawTransactionMetadata);
              const parsedRawData: unknown =
                typeof item.raw_data === 'string' ? JSON.parse(item.raw_data) : item.raw_data;

              // Combine import params and result metadata into session metadata format
              const parsedSessionMetadata: ImportSessionMetadata = {
                ...parsedImportParams,
                ...parsedResultMetadata,
              };

              const result = normalizer.normalize(parsedRawData, parsedMetadata, parsedSessionMetadata);

              if (result.isOk()) {
                normalizedRawDataItems.push(result.value);
              } else {
                const error = result.error;
                if (error.type === 'skip') {
                  // Safe skip - transaction is not an asset transfer or not relevant
                  skippedItems.push({ itemId: item.id, reason: error.reason });
                  this.logger.debug(`Skipped item ${item.id}: ${error.reason}`);
                } else {
                  // Actual error - normalization failed
                  const errorMsg = `Normalization failed: ${error.message}`;
                  normalizationErrors.push({ error: errorMsg, itemId: item.id });
                  this.logger.error(`${errorMsg} for raw data item ${item.id} in session ${session.id}`);
                }
              }
            }
          }
        } else {
          for (const item of pendingItems) {
            // raw_data is a JSON string that needs parsing
            const parsedData: unknown = typeof item.raw_data === 'string' ? JSON.parse(item.raw_data) : item.raw_data;
            normalizedRawDataItems.push(parsedData);
          }
        }

        // STRICT MODE: Fail if any raw data items could not be normalized (but skips are OK)
        if (normalizationErrors.length > 0) {
          this.logger.error(
            `CRITICAL: ${normalizationErrors.length}/${pendingItems.length} items failed normalization in session ${session.id}:\n${normalizationErrors
              .map((e, i) => `  ${i + 1}. Item ${e.itemId}: ${e.error}`)
              .join('\n')}`
          );

          return err(
            new Error(
              `Cannot proceed: ${normalizationErrors.length}/${pendingItems.length} raw data items failed normalization in session ${session.id}. ` +
                `This would corrupt portfolio calculations. Errors: ${normalizationErrors
                  .map((e) => `Item ${e.itemId}: ${e.error}`)
                  .join('; ')}`
            )
          );
        }

        // Log summary of skipped items if any
        if (skippedItems.length > 0) {
          this.logger.info(
            `Skipped ${skippedItems.length}/${pendingItems.length} items in session ${session.id} (non-asset operations or irrelevant transactions)`
          );
        }

        // Create processor with session-specific context
        const processor = await this.processorFactory.create(sourceId, sourceType);

        // Process this session's raw data
        const sessionTransactionsResult = await processor.process(normalizedRawDataItems, parsedResultMetadata);

        if (sessionTransactionsResult.isErr()) {
          this.logger.error(
            `CRITICAL: Processing failed for session ${session.id} - ${sessionTransactionsResult.error}`
          );
          return err(
            new Error(
              `Cannot proceed: Session ${session.id} processing failed. ${sessionTransactionsResult.error}. ` +
                `This would corrupt portfolio calculations by losing transactions from this import session.`
            )
          );
        }

        const sessionTransactions = sessionTransactionsResult.value;
        allTransactions.push(...sessionTransactions.map((tx) => ({ ...tx, sessionId: session.id })));

        this.logger.debug(`Processed ${sessionTransactions.length} transactions for session ${session.id}`);
      }

      const transactions = allTransactions;

      // Save processed transactions to database
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

      // Mark all processed raw data items as processed - both those that generated transactions and those that were skipped
      const allProcessedItems = sessionsToProcess.flatMap((sessionData) =>
        sessionData.rawDataItems.filter((item) => item.processing_status === 'pending')
      );
      const allRawDataIds = allProcessedItems.map((item) => item.id);

      const markAsProcessedResult = await this.rawDataRepository.markAsProcessed(
        sourceId,
        allRawDataIds,
        filters?.providerId
      );

      // Handle Result type - fail fast if marking fails
      if (markAsProcessedResult.isErr()) {
        return err(markAsProcessedResult.error);
      }

      // Log the processing results
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`CRITICAL: Unexpected processing failure for ${sourceId}: ${errorMessage}`);
      return err(new Error(`Unexpected processing failure for ${sourceId}: ${errorMessage}`));
    }
  }
}
