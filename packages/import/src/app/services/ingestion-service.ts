import type { UniversalTransaction } from '@crypto/core';
import type { Database } from '@crypto/data';
import { type StoredRawData } from '@crypto/data';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

import type { ImportResult } from '../../index.ts';
import type { BlockchainProviderManager } from '../../infrastructure/blockchains/shared/blockchain-provider-manager.ts';
import { ImportSessionRepository } from '../../infrastructure/persistence/import-session-repository.ts';
import type { LoadRawDataFilters } from '../../infrastructure/persistence/raw-data-repository.ts';
import { RawDataRepository } from '../../infrastructure/persistence/raw-data-repository.ts';
import { ImporterFactory } from '../../infrastructure/shared/importers/importer-factory.ts';
import { ProcessorFactory } from '../../infrastructure/shared/processors/processor-factory.ts';
import type { ApiClientRawData, ImportParams } from '../ports/importers.ts';
import type { ProcessResult, ProcessingImportSession, ImportSessionMetadata } from '../ports/processors.ts';

/**
 * Manages the ETL pipeline for cryptocurrency transaction data.
 * Handles the Import → Process → Load workflow with proper error handling
 * and dependency injection.
 */
export class TransactionIngestionService {
  private logger: Logger;
  private providerManager?: BlockchainProviderManager | undefined;
  private rawDataRepository: RawDataRepository;
  private sessionRepository: ImportSessionRepository;

  constructor(
    private database: Database,
    providerManager?: BlockchainProviderManager
  ) {
    this.logger = getLogger('TransactionIngestionService');
    this.sessionRepository = new ImportSessionRepository(this.database);
    this.rawDataRepository = new RawDataRepository(this.database);
    this.providerManager = providerManager;
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
   * Execute the full ETL pipeline: Import → Store Raw Data → Process → Load.
   */
  async importAndProcess(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    params: ImportParams
  ): Promise<{ imported: number; processed: number }> {
    this.logger.info(`Starting full ETL pipeline for ${sourceId} (${sourceType})`);

    try {
      // Step 1: Import raw data
      const importResult = await this.importFromSource(sourceId, sourceType, params);

      // Step 2: Process and load
      const processResult = await this.processAndStore(sourceId, sourceType, {
        importSessionId: importResult.importSessionId,
      });

      this.logger.info(
        `Completed full ETL pipeline for ${sourceId}: ${importResult.imported} imported, ${processResult.processed} processed`
      );

      return {
        imported: importResult.imported,
        processed: processResult.processed,
      };
    } catch (error) {
      this.logger.error(`ETL pipeline failed for ${sourceId}: ${String(error)}`);
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
    let importSessionId: number | undefined;
    try {
      importSessionId = await this.sessionRepository.create(sourceId, sourceType, params.providerId, {
        address: params.address,
        csvDirectories: params.csvDirectories,
        importedAt: Date.now(),
        importParams: params,
      });
      sessionCreated = true;
      this.logger.debug(`Created import session: ${importSessionId}`);

      // Create importer
      const importer = await ImporterFactory.create(sourceId, sourceType, params.providerId, this.providerManager);

      // Validate source before import
      const isValidSource = await importer.canImport(params);
      if (!isValidSource) {
        throw new Error(`Source validation failed for ${sourceId}`);
      }

      // Import raw data
      const importResult = await importer.import(params);
      const rawData = importResult.rawData;

      // Save raw data to storage
      const savedCount = await this.rawDataRepository.save(
        sourceId,
        sourceType,
        rawData.map((item, _index) => ({
          data: item,
        })),
        {
          importSessionId: importSessionId ?? undefined,
          metadata: {
            importedAt: Date.now(),
            importParams: params,
          },
          providerId: params.providerId ?? undefined,
        }
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

          await this.sessionRepository.update(importSessionId, { sessionMetadata });
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
      if (sessionCreated && typeof importSessionId === 'number') {
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
  async processAndStore(
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

      // Use combined query to fetch sessions with their raw data in a single JOIN
      const sessionsWithRawData = await this.database.getImportSessionsWithRawData({
        sourceId: sourceId,
      });

      // Filter sessions to only include those with pending raw data items
      const sessionsToProcess = sessionsWithRawData.filter((sessionData) =>
        sessionData.rawDataItems.some(
          (item) =>
            item.processingStatus === 'pending' &&
            (!filters?.importSessionId || item.importSessionId === filters.importSessionId)
        )
      );

      this.logger.info(`Processing ${sessionsToProcess.length} sessions with pending raw data`);

      const allTransactions: UniversalTransaction[] = [];

      // Process each session with its raw data and metadata
      for (const sessionData of sessionsToProcess) {
        const { rawDataItems: sessionRawItems, session } = sessionData;

        // Filter to only pending items for this session
        const pendingItems = sessionRawItems.filter((item) => item.processingStatus === 'pending');

        if (pendingItems.length === 0) {
          continue;
        }

        // Create processor with session-specific context
        const processor = await ProcessorFactory.create(sourceId, sourceType);

        // Create ProcessingImportSession for this session
        const processingSession: ProcessingImportSession = {
          createdAt: session.createdAt,
          id: session.id,
          rawDataItems: pendingItems as StoredRawData<ApiClientRawData<unknown>>[],
          sessionMetadata: session.sessionMetadata as ImportSessionMetadata | undefined,
          sourceId: session.sourceId,
          sourceType: session.sourceType,
          status: 'processing',
        };

        // Process this session's raw data
        const sessionTransactions = await processor.process(processingSession);
        allTransactions.push(...sessionTransactions);

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
          await this.database.saveTransaction(transaction);
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
        sessionData.rawDataItems.filter((item) => item.processingStatus === 'pending')
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
