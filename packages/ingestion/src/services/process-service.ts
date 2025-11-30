import { getErrorMessage } from '@exitbook/core';
import type { SourceType, UniversalTransaction } from '@exitbook/core';
import type { AccountRepository, ITransactionRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { progress } from '@exitbook/ui';
import { err, ok, Result } from 'neverthrow';

import { getBlockchainAdapter } from '../infrastructure/blockchains/index.js';
import { createExchangeProcessor } from '../infrastructure/exchanges/shared/exchange-processor-factory.js';
import type { ITokenMetadataService } from '../services/token-metadata/token-metadata-service.interface.js';
import type { ProcessResult } from '../types/processors.js';
import type { IDataSourceRepository, IRawDataRepository, LoadRawDataFilters } from '../types/repositories.js';

import {
  buildSessionProcessingQueue,
  extractUniqueDataSourceIds,
  filterSessionsWithPendingData,
  groupRawDataBySession,
} from './process-service-utils.js';

export class TransactionProcessService {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private dataSourceRepository: IDataSourceRepository,
    private accountRepository: AccountRepository,
    private transactionRepository: ITransactionRepository,
    private tokenMetadataService: ITokenMetadataService
  ) {
    this.logger = getLogger('TransactionProcessService');
  }

  /**
   * Get processing status summary for an account.
   * Per ADR-007: Query by accountId instead of sourceId
   */
  async getProcessingStatus(accountId: number): Promise<
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
        accountId: accountId,
      }),
      this.rawDataRepository.load({
        processingStatus: 'processed',
        accountId: accountId,
      }),
      this.rawDataRepository.load({
        processingStatus: 'failed',
        accountId: accountId,
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
        // Per ADR-007: Get account to derive sourceId and sourceType
        const accountResult = await this.accountRepository.findById(dataSource.accountId);
        if (accountResult.isErr()) {
          const errorMsg = `Failed to load account for session ${dataSource.id}: ${accountResult.error.message}`;
          this.logger.error(errorMsg);
          allErrors.push(errorMsg);
          continue;
        }

        const account = accountResult.value;
        const sourceId = account.sourceName;
        const sourceType: SourceType = account.accountType === 'blockchain' ? 'blockchain' : 'exchange';

        this.logger.info(`Processing source: ${sourceId} (${sourceType})`);

        const result = await this.processRawDataToTransactions(sourceId, sourceType, {
          dataSourceId: dataSource.id,
        });

        if (result.isErr()) {
          const errorMsg = `Failed to process ${sourceId}: ${result.error.message}`;
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
   * Per ADR-007: filters should contain dataSourceId or accountId, not sourceId
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

      // Per ADR-007: Get sessions via accountId or dataSourceId filter
      let allSessions;
      if (filters?.accountId) {
        const allSessionsResult = await this.dataSourceRepository.findByAccount(filters.accountId);
        if (allSessionsResult.isErr()) {
          return err(allSessionsResult.error);
        }
        allSessions = allSessionsResult.value;
      } else if (filters?.dataSourceId) {
        const sessionResult = await this.dataSourceRepository.findById(filters.dataSourceId);
        if (sessionResult.isErr()) {
          return err(sessionResult.error);
        }
        allSessions = sessionResult.value ? [sessionResult.value] : [];
      } else {
        // Fallback: get all sessions (not recommended for performance)
        const allSessionsResult = await this.dataSourceRepository.findAll();
        if (allSessionsResult.isErr()) {
          return err(allSessionsResult.error);
        }
        allSessions = allSessionsResult.value;
      }

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

      progress.update('Transforming transactions...');

      for (const sessionData of sessionsToProcess) {
        const { rawDataItems: sessionRawItems, session } = sessionData;

        const pendingItems = sessionRawItems.filter((item) => item.processingStatus === 'pending');

        if (pendingItems.length === 0) {
          continue;
        }

        const normalizedRawDataItems: unknown[] = [];

        // Session metadata for processor context
        // Import identity now lives on accounts, not sessions
        let parsedSessionMetadata = session.importResultMetadata;

        // For xpub/HD wallet sessions: augment metadata with sibling addresses
        // This restores multi-address fund-flow analysis while maintaining parent/child architecture
        if (sourceType === 'blockchain') {
          const accountResult = await this.accountRepository.findById(session.accountId);
          if (accountResult.isOk()) {
            const account = accountResult.value;

            // If this account is a child of an xpub parent, get all sibling addresses
            if (account.parentAccountId) {
              const siblingsResult = await this.accountRepository.findByParent(account.parentAccountId);
              if (siblingsResult.isOk()) {
                const siblings = siblingsResult.value;
                // Include all sibling addresses (excluding this account's own address which is already in metadata)
                const derivedAddresses = siblings
                  .filter((sibling) => sibling.id !== account.id)
                  .map((sibling) => sibling.identifier);

                // Augment metadata with derivedAddresses for processor fund-flow analysis
                parsedSessionMetadata = {
                  ...parsedSessionMetadata,
                  derivedAddresses,
                };

                this.logger.debug(
                  `Session ${session.id}: Augmented metadata with ${derivedAddresses.length} sibling addresses for multi-address fund-flow analysis`
                );
              }
            }
          }
        }

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
          const adapter = getBlockchainAdapter(normalizedSourceId);
          if (!adapter) {
            return err(new Error(`Unknown blockchain: ${sourceId}`));
          }
          const processorResult = adapter.createProcessor(this.tokenMetadataService);
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

      progress.update(`Saving ${transactions.length} processed transactions...`);
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
