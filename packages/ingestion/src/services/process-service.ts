import { getErrorMessage } from '@exitbook/core';
import type { SourceMetadata, SourceType, UniversalTransaction } from '@exitbook/core';
import type { ITransactionRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/shared-logger';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, Result } from 'neverthrow';

import { getBlockchainConfig } from '../infrastructure/blockchains/index.ts';
import { createExchangeProcessor } from '../infrastructure/exchanges/shared/exchange-processor-factory.ts';
import type { ITokenMetadataService } from '../services/token-metadata/token-metadata-service.interface.ts';
import type { ProcessResult } from '../types/processors.ts';
import type { IDataSourceRepository, IRawDataRepository, LoadRawDataFilters } from '../types/repositories.ts';

import {
  buildSessionProcessingQueue,
  extractUniqueDataSourceIds,
  filterSessionsWithPendingData,
  groupRawDataBySession,
} from './process-service-utils.ts';

export class TransactionProcessService {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private dataSourceRepository: IDataSourceRepository,
    private transactionRepository: ITransactionRepository,
    private tokenMetadataService: ITokenMetadataService
  ) {
    this.logger = getLogger('TransactionProcessService');
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
   * Process all data sources that have pending raw data.
   */
  async processAllPending(): Promise<Result<ProcessResult, Error>> {
    this.logger.info('Processing all data sources with pending records');

    try {
      // Load all pending raw data
      const pendingDataResult = await this.rawDataRepository.load({
        processingStatus: 'pending',
      });

      if (pendingDataResult.isErr()) {
        return err(pendingDataResult.error);
      }

      const pendingData = pendingDataResult.value;

      if (pendingData.length === 0) {
        this.logger.info('No pending raw data found to process');
        return ok({ errors: [], failed: 0, processed: 0 });
      }

      this.logger.info(`Found ${pendingData.length} pending records across all sources`);

      // Use pure function to extract unique data source IDs
      const dataSourceIds = extractUniqueDataSourceIds(pendingData);

      this.logger.info(`Found ${dataSourceIds.length} data sources with pending records`);

      // Load all data sources
      const dataSourcesResult = await this.dataSourceRepository.findAll();
      if (dataSourcesResult.isErr()) {
        return err(dataSourcesResult.error);
      }

      const dataSources = dataSourcesResult.value.filter((ds) => dataSourceIds.includes(ds.id));

      // Process each source
      let totalProcessed = 0;
      const allErrors: string[] = [];

      for (const dataSource of dataSources) {
        this.logger.info(`Processing source: ${dataSource.sourceId} (${dataSource.sourceType})`);

        const result = await this.processRawDataToTransactions(dataSource.sourceId, dataSource.sourceType, {
          dataSourceId: dataSource.id,
        });

        if (result.isErr()) {
          const errorMsg = `Failed to process ${dataSource.sourceId}: ${result.error.message}`;
          this.logger.error(errorMsg);
          allErrors.push(errorMsg);
          continue;
        }

        totalProcessed += result.value.processed;
        allErrors.push(...result.value.errors);
      }

      this.logger.info(`Completed processing all sources: ${totalProcessed} transactions processed`);

      return ok({
        errors: allErrors,
        failed: 0,
        processed: totalProcessed,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Unexpected error processing all pending data: ${errorMessage}`);
      return err(new Error(`Unexpected error processing all pending data: ${errorMessage}`));
    }
  }

  /**
   * Process raw data from storage into UniversalTransaction format and save to database.
   */
  async processRawDataToTransactions(
    sourceId: string,
    sourceType: SourceType,
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

      const allSessionsResult = await this.dataSourceRepository.findBySource(sourceId);

      if (allSessionsResult.isErr()) {
        return err(allSessionsResult.error);
      }
      const allSessions = allSessionsResult.value;

      this.logger.debug(
        `Found ${allSessions.length} total sessions for source: ${allSessions.map((s) => s.id).join(', ')}`
      );

      // Use pure function to group raw data by session
      const rawDataBySessionId = groupRawDataBySession(rawDataItems);

      this.logger.debug(
        `Grouped raw data by session: ${Array.from(rawDataBySessionId.entries())
          .map(([sessionId, items]) => `Session ${sessionId}: ${items.length} items`)
          .join(', ')}`
      );

      // Use pure function to filter sessions with pending data
      const filteredSessions = filterSessionsWithPendingData(allSessions, rawDataBySessionId, filters);

      // Use pure function to build processing queue
      const sessionsToProcess = buildSessionProcessingQueue(filteredSessions);

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

        const parsedSessionMetadata: SourceMetadata = {
          ...session.importParams,
          ...session.importResultMetadata,
        };

        for (const item of pendingItems) {
          let normalizedData: unknown = item.normalizedData;

          if (!normalizedData || Object.keys(normalizedData as Record<string, never>).length === 0) {
            normalizedData = item.rawData;
          }

          if (sourceType === 'exchange') {
            const dataPackage = {
              raw: item.rawData,
              normalized: normalizedData,
              externalId: item.externalId || '',
              cursor: item.cursor || {},
            };

            normalizedRawDataItems.push(dataPackage);
          } else {
            normalizedRawDataItems.push(normalizedData);
          }
        }

        // Create processor based on source type
        let processor;
        if (sourceType === 'blockchain') {
          // Normalize sourceId to lowercase for config lookup (registry keys are lowercase)
          const normalizedSourceId = sourceId.toLowerCase();
          const config = getBlockchainConfig(normalizedSourceId);
          if (!config) {
            return err(new Error(`Unknown blockchain: ${sourceId}`));
          }
          const processorResult = config.createProcessor(this.tokenMetadataService);
          if (processorResult.isErr()) {
            return err(processorResult.error);
          }
          processor = processorResult.value;
        } else {
          const processorResult = await createExchangeProcessor(sourceId, parsedSessionMetadata);
          if (processorResult.isErr()) {
            return err(processorResult.error);
          }
          processor = processorResult.value;
        }

        const sessionTransactionsResult = await processor.process(normalizedRawDataItems, parsedSessionMetadata);

        if (sessionTransactionsResult.isErr()) {
          this.logger.error(
            `CRITICAL: Processing failed for session ${session.id} - ${sessionTransactionsResult.error}`
          );
          return err(
            new Error(
              `Cannot proceed: Session ${session.id} processing failed. ${sessionTransactionsResult.error}. ` +
                `This would corrupt portfolio calculations by losing transactions from this data source.`
            )
          );
        }

        const sessionTransactions = sessionTransactionsResult.value;
        allTransactions.push(
          ...sessionTransactions.map((tx: UniversalTransaction) => ({ ...tx, sessionId: session.id }))
        );

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
}
