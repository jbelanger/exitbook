import type { RawData } from '@exitbook/data';
import type { ImportParams, RawTransactionMetadata } from '@exitbook/import/app/ports/importers.ts';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import type { Logger } from '@exitbook/shared-logger';
import { getLogger } from '@exitbook/shared-logger';

import type { ImportResult } from '../../index.js';
import type { IBlockchainNormalizer } from '../ports/blockchain-normalizer.interface.ts';
import type { IImportSessionRepository } from '../ports/import-session-repository.interface.ts';
import type { IImporterFactory } from '../ports/importer-factory.interface.ts';
import type { IProcessorFactory } from '../ports/processor-factory.js';
import type { IRawDataRepository, LoadRawDataFilters } from '../ports/raw-data-repository.js';
import type {
  ProcessResult,
  ProcessingImportSession,
  ImportSessionMetadata,
} from '../ports/transaction-processor.interface.ts';
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
  async getProcessingStatus(sourceId: string) {
    try {
      const [pending, processedItems, failedItems] = await Promise.all([
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

      return {
        failed: failedItems.length,
        pending: pending.length,
        processed: processedItems.length,
        total: pending.length + processedItems.length + failedItems.length,
      };
    } catch (error) {
      this.logger.error(`Failed to get processing status: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Import raw data from source and store it in external_transaction_data table.
   */
  async importFromSource(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    params: ImportParams
  ): Promise<ImportResult> {
    this.logger.info(`Starting import for ${sourceId} (${sourceType})`);

    const startTime = Date.now();
    let sessionCreated = false;
    let importSessionId = 0;
    try {
      importSessionId = await this.sessionRepository.create(sourceId, sourceType, params.providerId, {
        address: params.address,
        csvDirectories: params.csvDirectories,
        importedAt: Date.now(),
        importParams: params,
      });
      sessionCreated = true;
      this.logger.info(`Created import session: ${importSessionId}`);

      const importer = await this.importerFactory.create(sourceId, sourceType, params.providerId);

      if (!importer) {
        throw new Error(`No importer found for source ${sourceId} of type ${sourceType}`);
      }
      this.logger.info(`Importer for ${sourceId} created successfully`);

      // Import raw data
      this.logger.info('Starting raw data import...');
      const importResultWrapper = await importer.import(params);

      if (importResultWrapper.isErr()) {
        throw importResultWrapper.error;
      }

      const importResult = importResultWrapper.value;
      const rawData = importResult.rawTransactions;

      // Save all raw data items to storage in a single transaction
      const savedCount = await this.rawDataRepository.saveBatch(
        rawData.map((element) => ({
          metadata: element.metadata,
          providerId: element.metadata.providerId,
          rawData: element.rawData,
        })),
        importSessionId
      );

      // Update session with success and metadata
      if (sessionCreated && typeof importSessionId === 'number') {
        this.logger.debug(`Finalizing session ${importSessionId} with ${savedCount} transactions`);
        await this.sessionRepository.finalize(importSessionId, 'completed', startTime, savedCount, 0);

        // Update session with import metadata if available
        if (importResult.metadata) {
          const sessionMetadata = {
            address: params.address,
            csvDirectories: params.csvDirectories,
            importedAt: Date.now(),
            importParams: params,
            ...importResult.metadata,
          };

          await this.sessionRepository.update(importSessionId, {
            id: importSessionId,
            session_metadata: JSON.stringify(sessionMetadata),
          });
          this.logger.debug(
            `Updated session ${importSessionId} with metadata keys: ${Object.keys(importResult.metadata).join(', ')}`
          );
        }

        this.logger.debug(`Successfully finalized session ${importSessionId}`);
      }

      this.logger.info(`Import completed for ${sourceId}: ${savedCount} items saved`);

      return {
        imported: savedCount,
        importSessionId,
        providerId: params.providerId ?? undefined,
      };
    } catch (error) {
      // Update session with error if we created it
      if (sessionCreated && typeof importSessionId === 'number' && importSessionId > 0) {
        try {
          await this.sessionRepository.finalize(
            importSessionId,
            'failed',
            startTime,
            0,
            0,
            error instanceof Error ? error.message : String(error),
            error instanceof Error ? { stack: error.stack } : { error: String(error) }
          );
        } catch (sessionError) {
          this.logger.error(`Failed to update session on error: ${String(sessionError)}`);
        }
      }

      this.logger.error(`Import failed for ${sourceId}: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Process raw data from storage into UniversalTransaction format and save to database.
   */
  async processRawDataToTransactions(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    filters?: LoadRawDataFilters
  ): Promise<ProcessResult> {
    this.logger.info(`Starting processing for ${sourceId} (${sourceType})`);

    try {
      // Load raw data from storage
      const loadFilters: LoadRawDataFilters = {
        processingStatus: 'pending',
        sourceId: sourceId,
        ...filters,
      };

      const rawDataItems = await this.rawDataRepository.load(loadFilters);

      if (rawDataItems.length === 0) {
        this.logger.warn(`No pending raw data found for processing: ${sourceId}`);
        return { errors: [], failed: 0, processed: 0 };
      }

      this.logger.info(`Found ${rawDataItems.length} raw data items to process for ${sourceId}`);

      // Fetch sessions and raw data separately
      const allSessions = await this.sessionRepository.findBySource(sourceId);

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
        if (sourceType === 'blockchain') {
          const normalizer = this.blockchainNormalizer;
          if (normalizer) {
            for (const item of pendingItems) {
              try {
                const result = normalizer.normalize(
                  item.raw_data,
                  item.metadata as RawTransactionMetadata,
                  session.session_metadata as ImportSessionMetadata
                );
                if (result) result.map((r) => normalizedRawDataItems.push(r));
              } catch (normError) {
                this.logger.error(
                  `Normalization failed for raw data item ${item.id} in session ${session.id}: ${String(normError)}`
                );
              }
            }
          }
        } else {
          for (const item of pendingItems) {
            normalizedRawDataItems.push(item.raw_data);
          }
        }

        // Create processor with session-specific context
        const processor = await this.processorFactory.create(sourceId, sourceType);

        // Create ProcessingImportSession for this session
        const processingSession: ProcessingImportSession = {
          createdAt: new Date(session.created_at).getTime(),
          id: session.id,
          normalizedData: normalizedRawDataItems,
          sessionMetadata: session.session_metadata as ImportSessionMetadata | undefined,
          sourceId: session.source_id,
          sourceType: session.source_type,
          status: 'processing',
        };

        // Process this session's raw data
        const sessionTransactionsResult = await processor.process(processingSession);

        if (sessionTransactionsResult.isErr()) {
          this.logger.error(`Processing failed for session ${session.id}: ${sessionTransactionsResult.error}`);
          continue;
        }

        const sessionTransactions = sessionTransactionsResult.value;
        allTransactions.push(...sessionTransactions.map((tx) => ({ ...tx, sessionId: session.id })));

        this.logger.debug(`Processed ${sessionTransactions.length} transactions for session ${session.id}`);
      }

      const transactions = allTransactions;

      // Save processed transactions to database
      // Note: This would typically use a transaction service, but for now we'll use the database directly
      let savedCount = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const transaction of transactions) {
        try {
          await this.transactionRepository.save(transaction, transaction.sessionId);
          savedCount++;
        } catch (error) {
          failed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to save transaction ${transaction.id}: ${errorMessage}`);
          this.logger.error(`Failed to save transaction ${transaction.id}: ${errorMessage}`);
        }
      }

      // Mark all processed raw data items as processed - both those that generated transactions and those that were skipped
      const allProcessedItems = sessionsToProcess.flatMap((sessionData) =>
        sessionData.rawDataItems.filter((item) => item.processing_status === 'pending')
      );
      const allRawDataIds = allProcessedItems.map((item) => item.id);
      await this.rawDataRepository.markAsProcessed(sourceId, allRawDataIds, filters?.providerId);

      // Log the processing results
      const skippedCount = allProcessedItems.length - transactions.length;
      if (skippedCount > 0) {
        this.logger.info(`${skippedCount} items were processed but skipped (likely non-standard operation types)`);
      }

      this.logger.info(`Processing completed for ${sourceId}: ${savedCount} processed, ${failed} failed`);

      return {
        errors,
        failed,
        processed: savedCount,
      };
    } catch (error) {
      this.logger.error(`Processing failed for ${sourceId}: ${String(error)}`);
      throw error;
    }
  }
}
