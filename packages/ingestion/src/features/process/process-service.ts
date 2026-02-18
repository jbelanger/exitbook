import { NormalizedTransactionBaseSchema, type BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { getErrorMessage, type RawTransaction } from '@exitbook/core';
import type {
  AccountQueries,
  ImportSessionQueries,
  RawDataQueries,
  TransactionQueries,
  KyselyDB,
} from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { IngestionEvent } from '../../events.js';
import { getBlockchainAdapter } from '../../shared/types/blockchain-adapter.js';
import { getExchangeAdapter } from '../../shared/types/exchange-adapter.js';
import type {
  ProcessResult,
  ProcessingContext,
  ProcessedTransaction,
  ITransactionProcessor,
} from '../../shared/types/processors.js';
import { NearRawDataQueries } from '../../sources/blockchains/near/near-raw-data-queries.js';
import type { IScamDetectionService } from '../scam-detection/scam-detection-service.interface.js';
import { ScamDetectionService } from '../scam-detection/scam-detection-service.js';
import type { ITokenMetadataService } from '../token-metadata/token-metadata-service.interface.js';

import {
  AllAtOnceBatchProvider,
  HashGroupedBatchProvider,
  NearStreamBatchProvider,
  type IRawDataBatchProvider,
} from './batch-providers/index.js';

const TRANSACTION_SAVE_BATCH_SIZE = 500;
const RAW_DATA_MARK_BATCH_SIZE = 500;
const RAW_DATA_HASH_BATCH_SIZE = 100; // For blockchain accounts, process in hash-grouped batches to ensure correlation integrity

export class TransactionProcessService {
  private logger: Logger;
  private scamDetectionService: IScamDetectionService;

  constructor(
    private rawDataQueries: RawDataQueries,
    private accountQueries: AccountQueries,
    private transactionQueries: TransactionQueries,
    private providerManager: BlockchainProviderManager,
    private tokenMetadataService: ITokenMetadataService,
    private importSessionQueries: ImportSessionQueries,
    private eventBus: EventBus<IngestionEvent>,
    private db: KyselyDB
  ) {
    this.logger = getLogger('TransactionProcessService');
    this.scamDetectionService = new ScamDetectionService(eventBus);
  }

  /**
   * Process imported sessions from import operation.
   * Emits process.started and process.completed events for dashboard coordination.
   */
  async processImportedSessions(accountIds: number[]): Promise<Result<ProcessResult, Error>> {
    if (accountIds.length === 0) {
      return ok({ errors: [], failed: 0, processed: 0 });
    }

    const startTime = Date.now();
    try {
      // Count total raw data to process and collect transaction counts by stream type
      let totalRaw = 0;
      const accountTransactionCounts = new Map<number, Map<string, number>>();

      for (const accountId of accountIds) {
        const countResult = await this.rawDataQueries.countPending(accountId);
        if (countResult.isOk()) {
          totalRaw += countResult.value;
        }

        // Fetch transaction counts by stream type for dashboard display
        const streamCountsResult = await this.rawDataQueries.countByStreamType(accountId);
        if (streamCountsResult.isOk()) {
          accountTransactionCounts.set(accountId, streamCountsResult.value);
        }
      }

      // Emit process.started event
      this.eventBus.emit({
        type: 'process.started',
        accountIds,
        totalRaw,
        accountTransactionCounts: accountTransactionCounts.size > 0 ? accountTransactionCounts : undefined,
      });

      // Process each account
      let totalProcessed = 0;
      const allErrors: string[] = [];

      for (const accountId of accountIds) {
        const result = await this.processAccountTransactions(accountId);

        if (result.isErr()) {
          // Emit failure event and return error
          this.eventBus.emit({
            type: 'process.failed',
            accountIds: [accountId],
            error: result.error.message,
          });
          return err(result.error);
        }

        totalProcessed += result.value.processed;
        allErrors.push(...result.value.errors);
      }

      // Emit process.completed event
      this.eventBus.emit({
        type: 'process.completed',
        accountIds,
        durationMs: Date.now() - startTime,
        totalProcessed,
        errors: allErrors,
      });

      return ok({
        errors: allErrors,
        failed: 0,
        processed: totalProcessed,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Unexpected error processing imported sessions: ${errorMessage}`);

      // Emit failure event
      this.eventBus.emit({
        type: 'process.failed',
        accountIds,
        error: errorMessage,
      });

      return err(new Error(`Unexpected error processing imported sessions: ${errorMessage}`));
    }
  }

  /**
   * Process all accounts that have pending raw data.
   */
  async processAllPending(): Promise<Result<ProcessResult, Error>> {
    this.logger.info('Processing all accounts with pending records');

    try {
      const accountIdsResult = await this.rawDataQueries.getAccountsWithPendingData();
      if (accountIdsResult.isErr()) {
        return err(accountIdsResult.error);
      }

      const accountIds = accountIdsResult.value;

      if (accountIds.length === 0) {
        this.logger.info('No pending raw data found to process');
        return ok({ errors: [], failed: 0, processed: 0 });
      }

      this.logger.debug(`Found pending records across ${accountIds.length} accounts`);

      // CRITICAL: Check for active imports before processing to prevent data corruption
      const activeImportsCheck = await this.checkForIncompleteImports(accountIds);
      if (activeImportsCheck.isErr()) {
        return err(activeImportsCheck.error);
      }

      // Process each account
      let totalProcessed = 0;
      const allErrors: string[] = [];

      for (const accountId of accountIds) {
        const result = await this.processAccountTransactions(accountId);

        if (result.isErr()) {
          const errorMsg = `Failed to process account ${accountId}: ${result.error.message}`;
          this.logger.error(errorMsg);
          allErrors.push(errorMsg);
          continue;
        }

        totalProcessed += result.value.processed;
        allErrors.push(...result.value.errors);
      }

      this.logger.debug(`Completed processing all accounts: ${totalProcessed} transactions processed`);

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
   * Process all pending transactions for a specific account.
   */
  async processAccountTransactions(accountId: number): Promise<Result<ProcessResult, Error>> {
    try {
      // CRITICAL: Check for active import before processing to prevent data corruption
      const activeImportsCheck = await this.checkForIncompleteImports([accountId]);
      if (activeImportsCheck.isErr()) {
        return err(activeImportsCheck.error);
      }

      // Load account to get source information
      const accountResult = await this.accountQueries.findById(accountId);
      if (accountResult.isErr()) {
        return err(new Error(`Failed to load account ${accountId}: ${accountResult.error.message}`));
      }

      const account = accountResult.value;
      const sourceType = account.accountType;
      const sourceName = account.sourceName;

      // Choose batch provider based on source type
      const batchProvider = this.createBatchProvider(sourceType, sourceName, accountId);

      // Process using batch provider
      return this.processAccountWithBatchProvider(accountId, account, batchProvider);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`CRITICAL: Unexpected processing failure for account ${accountId}: ${errorMessage}`);
      return err(new Error(`Unexpected processing failure for account ${accountId}: ${errorMessage}`));
    }
  }

  /**
   * Create appropriate batch provider based on source type and name.
   */
  private createBatchProvider(sourceType: string, sourceName: string, accountId: number): IRawDataBatchProvider {
    // NEAR requires special multi-stream batch provider
    if (sourceType === 'blockchain' && sourceName.toLowerCase() === 'near') {
      const nearRawDataQueries = new NearRawDataQueries(this.db);
      return new NearStreamBatchProvider(nearRawDataQueries, accountId, RAW_DATA_HASH_BATCH_SIZE);
    }

    if (sourceType === 'blockchain') {
      // Hash-grouped batching for blockchains to ensure correlation integrity
      return new HashGroupedBatchProvider(this.rawDataQueries, accountId, RAW_DATA_HASH_BATCH_SIZE);
    } else {
      // All-at-once batching for exchanges (manageable data volumes)
      return new AllAtOnceBatchProvider(this.rawDataQueries, accountId);
    }
  }

  /**
   * Process account transactions using a batch provider.
   * Handles both exchange (all-at-once) and blockchain (hash-grouped) processing.
   */
  private async processAccountWithBatchProvider(
    accountId: number,
    account: { accountType: string; identifier: string; sourceName: string; userId?: number | undefined },
    batchProvider: IRawDataBatchProvider
  ): Promise<Result<ProcessResult, Error>> {
    const sourceName = account.sourceName.toLowerCase();
    let totalSaved = 0;
    let totalProcessed = 0;
    let batchNumber = 0;

    // Query pending count once at start
    const pendingCountResult = await this.rawDataQueries.countPending(accountId);
    let pendingCount = 0;
    if (pendingCountResult.isOk()) {
      pendingCount = pendingCountResult.value;
    } else {
      this.logger.warn(
        { error: pendingCountResult.error, accountId },
        'Failed to query pending count, defaulting to 0'
      );
    }

    // Build processing context once (used for all batches)
    const processingContext = await this.getProcessingContext(account, accountId);

    // Create processor once (reused for all batches)
    const processorResult = this.getProcessor(sourceName, account.accountType, accountId);
    if (processorResult.isErr()) {
      return err(processorResult.error);
    }
    const processor = processorResult.value;

    // Process batches until no more pending data
    while (batchProvider.hasMore()) {
      batchNumber++;

      const rawDataItemsResult = await batchProvider.fetchNextBatch();

      if (rawDataItemsResult.isErr()) {
        return err(rawDataItemsResult.error);
      }

      const rawDataItems = rawDataItemsResult.value;

      // No more pending data
      if (rawDataItems.length === 0) {
        break;
      }

      const batchStartTime = Date.now();

      // Emit batch started event
      this.eventBus.emit({
        type: 'process.batch.started',
        accountId,
        batchNumber,
        batchSize: rawDataItems.length,
        pendingCount,
      });

      this.logger.debug(
        `Processing batch ${batchNumber}: ${rawDataItems.length} items for account ${accountId} (${sourceName})`
      );

      const normalizedRawDataItemsResult = this.normalizeRawData(rawDataItems, account.accountType);
      if (normalizedRawDataItemsResult.isErr()) {
        this.logger.error(
          `CRITICAL: Failed to normalize raw data for account ${accountId} batch ${batchNumber} - ${normalizedRawDataItemsResult.error.message}`
        );
        return err(
          new Error(
            `Cannot proceed: Account ${accountId} processing failed at batch ${batchNumber}. ${normalizedRawDataItemsResult.error.message}. ` +
              `This would corrupt portfolio calculations by losing transactions from this account.`
          )
        );
      }
      const normalizedRawDataItems = normalizedRawDataItemsResult.value;

      // Process raw data into universal transactions
      const transactionsResult = await processor.process(normalizedRawDataItems, processingContext);

      if (transactionsResult.isErr()) {
        this.logger.error(
          `CRITICAL: Processing failed for account ${accountId} batch ${batchNumber} - ${transactionsResult.error}`
        );
        return err(
          new Error(
            `Cannot proceed: Account ${accountId} processing failed at batch ${batchNumber}. ${transactionsResult.error}. ` +
              `This would corrupt portfolio calculations by losing transactions from this account.`
          )
        );
      }

      const transactions = transactionsResult.value;
      totalProcessed += rawDataItems.length;

      // Save transactions
      const saveResult = await this.saveTransactions(transactions, accountId);
      if (saveResult.isErr()) {
        return err(saveResult.error);
      }
      const { saved, duplicates } = saveResult.value;

      totalSaved += saved;

      if (duplicates > 0) {
        this.logger.debug(
          `Account ${accountId} batch ${batchNumber}: ${duplicates} duplicate transactions were skipped during save`
        );
      }

      // Mark raw data items as processed
      const markResult = await this.markRawDataAsProcessed(rawDataItems);
      if (markResult.isErr()) {
        return err(markResult.error);
      }

      // Update pending count (approximate - tracks what we've processed)
      pendingCount = Math.max(0, pendingCount - rawDataItems.length);

      // Emit batch completed event
      const batchDurationMs = Date.now() - batchStartTime;
      this.eventBus.emit({
        type: 'process.batch.completed',
        accountId,
        batchNumber,
        batchSize: rawDataItems.length,
        durationMs: batchDurationMs,
        pendingCount,
      });
    }

    // No data was processed
    if (totalProcessed === 0) {
      this.logger.warn(`No pending raw data found for account ${accountId}`);
      return ok({ errors: [], failed: 0, processed: 0 });
    }

    const accountLabel = `Account ${accountId} (${sourceName})`.padEnd(25);

    if (batchNumber === 1) {
      const skippedCount = totalProcessed - totalSaved;
      if (skippedCount > 0) {
        this.logger.info(`• ${accountLabel}: Correlated ${totalProcessed} items into ${totalSaved} transactions.`);
      } else {
        this.logger.info(`• ${accountLabel}: Processed ${totalProcessed} items.`);
      }
    } else {
      this.logger.info(`• ${accountLabel}: Processed ${totalProcessed} items in ${batchNumber} batches.`);
    }

    return ok({
      errors: [],
      failed: 0,
      processed: totalSaved,
    });
  }

  private async getProcessingContext(
    account: { accountType: string; identifier: string; sourceName: string; userId?: number | undefined },
    accountId: number
  ): Promise<ProcessingContext> {
    const processingContext: ProcessingContext = {
      primaryAddress: '',
      userAddresses: [],
    };

    if (account.accountType === 'blockchain') {
      processingContext.primaryAddress = account.identifier;

      if (account.userId) {
        const userAccountsResult = await this.accountQueries.findAll({ userId: account.userId });
        if (userAccountsResult.isOk()) {
          const userAccounts = userAccountsResult.value;
          const userAddresses = userAccounts
            .filter((acc) => acc.sourceName === account.sourceName)
            .map((acc) => acc.identifier);

          if (userAddresses.length > 0) {
            processingContext.userAddresses = userAddresses;
            this.logger.debug(
              `Account ${accountId}: Augmented context with ${userAddresses.length} user addresses for multi-address fund-flow analysis`
            );
          }
        }
      }
    }
    return processingContext;
  }

  private getProcessor(
    sourceName: string,
    sourceType: string,
    accountId: number
  ): Result<ITransactionProcessor, Error> {
    if (sourceType === 'blockchain') {
      const adapter = getBlockchainAdapter(sourceName);
      if (!adapter) {
        return err(new Error(`Unknown blockchain: ${sourceName}`));
      }

      // NEAR requires NearRawDataQueries instead of shared RawDataQueries
      if (sourceName.toLowerCase() === 'near') {
        const nearRawDataQueries = new NearRawDataQueries(this.db);
        return adapter.createProcessor(
          this.providerManager,
          this.tokenMetadataService,
          this.scamDetectionService,
          nearRawDataQueries as unknown as RawDataQueries,
          accountId
        );
      }

      return adapter.createProcessor(
        this.providerManager,
        this.tokenMetadataService,
        this.scamDetectionService,
        this.rawDataQueries,
        accountId
      );
    } else {
      const adapter = getExchangeAdapter(sourceName);
      if (!adapter) {
        return err(new Error(`Unknown exchange: ${sourceName}`));
      }
      return ok(adapter.createProcessor());
    }
  }

  private normalizeRawData(rawDataItems: RawTransaction[], sourceType: string): Result<unknown[], Error> {
    const normalizedRawDataItems: unknown[] = [];
    const isExchange = sourceType === 'exchange-api' || sourceType === 'exchange-csv';

    for (const item of rawDataItems) {
      if (isExchange) {
        let normalizedData: unknown = item.normalizedData;

        const isEmpty = !normalizedData || Object.keys(normalizedData as Record<string, never>).length === 0;
        if (isEmpty) {
          normalizedData = item.providerData;
        }

        const dataPackage = {
          raw: item.providerData,
          normalized: normalizedData,
          eventId: item.eventId || '',
        };
        normalizedRawDataItems.push(dataPackage);
      } else {
        const normalizedData: unknown = item.normalizedData;
        const isEmpty = !normalizedData || Object.keys(normalizedData as Record<string, never>).length === 0;

        if (isEmpty) {
          return err(
            new Error(
              `Missing normalized_data for blockchain raw transaction ${item.id} (eventId: ${item.eventId}). ` +
                `Reimport required to restore validated normalized data.`
            )
          );
        }

        const validationResult = NormalizedTransactionBaseSchema.safeParse(normalizedData);
        if (!validationResult.success) {
          return err(
            new Error(
              `Invalid normalized_data for blockchain raw transaction ${item.id} (eventId: ${item.eventId}). ` +
                `Error: ${validationResult.error.message}`
            )
          );
        }

        normalizedRawDataItems.push(normalizedData);
      }
    }

    return ok(normalizedRawDataItems);
  }

  private async saveTransactions(
    transactions: ProcessedTransaction[],
    accountId: number
  ): Promise<Result<{ duplicates: number; saved: number }, Error>> {
    let savedCount = 0;
    let duplicateCount = 0;

    this.logger.debug(`Saving ${transactions.length} processed transactions...`);

    for (let start = 0; start < transactions.length; start += TRANSACTION_SAVE_BATCH_SIZE) {
      const batch = transactions.slice(start, start + TRANSACTION_SAVE_BATCH_SIZE);
      const saveResult = await this.transactionQueries.saveBatch(batch, accountId);

      if (saveResult.isErr()) {
        const errorMessage = `CRITICAL: Failed to save transactions batch starting at index ${start} for account ${accountId}: ${saveResult.error.message}`;
        this.logger.error(errorMessage);
        return err(
          new Error(
            `Cannot proceed: Failed to save processed transactions to database. ` +
              `This would corrupt portfolio calculations. Error: ${saveResult.error.message}`
          )
        );
      }

      savedCount += saveResult.value.saved;
      duplicateCount += saveResult.value.duplicates;
    }

    return ok({ saved: savedCount, duplicates: duplicateCount });
  }

  private async markRawDataAsProcessed(rawDataItems: { id: number }[]): Promise<Result<void, Error>> {
    const allRawDataIds = rawDataItems.map((item) => item.id);
    for (let start = 0; start < allRawDataIds.length; start += RAW_DATA_MARK_BATCH_SIZE) {
      const batchIds = allRawDataIds.slice(start, start + RAW_DATA_MARK_BATCH_SIZE);
      const markAsProcessedResult = await this.rawDataQueries.markAsProcessed(batchIds);

      if (markAsProcessedResult.isErr()) {
        return err(markAsProcessedResult.error);
      }
    }
    return ok(undefined);
  }

  /**
   * Check for active imports (status='started') across specified accounts.
   * CRITICAL: This prevents processing incomplete data from in-progress imports.
   *
   * @param accountIds - Account IDs to check for active imports
   * @returns Error if any active imports found, ok otherwise
   */
  private async checkForIncompleteImports(accountIds: number[]): Promise<Result<void, Error>> {
    if (accountIds.length === 0) {
      return ok(undefined);
    }

    const sessionsResult = await this.importSessionQueries.findByAccounts(accountIds);
    if (sessionsResult.isErr()) {
      return err(new Error(`Failed to check for active imports: ${sessionsResult.error.message}`));
    }

    const latestByAccount = new Map<number, (typeof sessionsResult.value)[number]>();
    for (const session of sessionsResult.value) {
      if (!latestByAccount.has(session.accountId)) {
        latestByAccount.set(session.accountId, session);
      }
    }

    const incompleteSessions = [...latestByAccount.values()].filter((session) => session.status !== 'completed');

    if (incompleteSessions.length > 0) {
      const affectedAccounts = incompleteSessions.map((s) => `${s.accountId}(${s.status})`);
      const accountsStr = affectedAccounts.join(', ');

      this.logger.warn(
        `Cannot process: latest import is incomplete for account(s): ${accountsStr}. ` +
          `Finish or re-run imports before processing.`
      );

      return err(
        new Error(
          `Processing blocked: Latest import session is not completed for account(s) ${accountsStr}. ` +
            `All transaction history must be fully fetched before processing to ensure data integrity. ` +
            `Please complete or re-run the import, then process again.`
        )
      );
    }

    return ok(undefined);
  }
}
