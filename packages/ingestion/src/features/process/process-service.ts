import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { getErrorMessage, type RawTransaction } from '@exitbook/core';
import type { AccountRepository, IRawDataRepository, ITransactionRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { getBlockchainAdapter } from '../../shared/types/blockchain-adapter.js';
import { getExchangeAdapter } from '../../shared/types/exchange-adapter.js';
import type {
  ProcessResult,
  ProcessingContext,
  ProcessedTransaction,
  ITransactionProcessor,
} from '../../shared/types/processors.js';
import type { IScamDetectionService } from '../scam-detection/scam-detection-service.interface.js';
import { ScamDetectionService } from '../scam-detection/scam-detection-service.js';
import type { ITokenMetadataService } from '../token-metadata/token-metadata-service.interface.js';

const TRANSACTION_SAVE_BATCH_SIZE = 500;
const RAW_DATA_MARK_BATCH_SIZE = 500;
const RAW_DATA_HASH_BATCH_SIZE = 100; // For blockchain accounts, process in hash-grouped batches to ensure correlation integrity

export class TransactionProcessService {
  private logger: Logger;
  private scamDetectionService: IScamDetectionService;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private accountRepository: AccountRepository,
    private transactionRepository: ITransactionRepository,
    private providerManager: BlockchainProviderManager,
    private tokenMetadataService: ITokenMetadataService
  ) {
    this.logger = getLogger('TransactionProcessService');
    this.scamDetectionService = new ScamDetectionService();
  }

  /**
   * Process all accounts that have pending raw data.
   */
  async processAllPending(): Promise<Result<ProcessResult, Error>> {
    this.logger.info('Processing all accounts with pending records');

    try {
      const accountIdsResult = await this.rawDataRepository.getAccountsWithPendingData();
      if (accountIdsResult.isErr()) {
        return err(accountIdsResult.error);
      }

      const accountIds = accountIdsResult.value;

      if (accountIds.length === 0) {
        this.logger.info('No pending raw data found to process');
        return ok({ errors: [], failed: 0, processed: 0 });
      }

      this.logger.debug(`Found pending records across ${accountIds.length} accounts`);

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
      // Load account to get source information
      const accountResult = await this.accountRepository.findById(accountId);
      if (accountResult.isErr()) {
        return err(new Error(`Failed to load account ${accountId}: ${accountResult.error.message}`));
      }

      const account = accountResult.value;
      const sourceType = account.accountType;

      // For blockchain accounts, use hash-grouped batch processing to:
      // 1. Avoid loading 100k+ transactions into memory
      // 2. Ensure all events with same blockchain_transaction_hash are processed together
      if (sourceType === 'blockchain') {
        return this.processAccountTransactionsChunked(accountId, account);
      }

      // Exchange processing - load all pending data at once
      return this.processExchangeAccountTransactions(accountId, account);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`CRITICAL: Unexpected processing failure for account ${accountId}: ${errorMessage}`);
      return err(new Error(`Unexpected processing failure for account ${accountId}: ${errorMessage}`));
    }
  }

  /**
   * Process exchange account transactions (all at once).
   */
  private async processExchangeAccountTransactions(
    accountId: number,
    account: { accountType: string; identifier: string; sourceName: string; userId?: number | undefined }
  ): Promise<Result<ProcessResult, Error>> {
    const sourceName = account.sourceName.toLowerCase();

    const rawDataItemsResult = await this.rawDataRepository.load({
      processingStatus: 'pending',
      accountId,
    });

    if (rawDataItemsResult.isErr()) {
      return err(rawDataItemsResult.error);
    }

    const rawDataItems = rawDataItemsResult.value;

    if (rawDataItems.length === 0) {
      this.logger.warn(`No pending raw data found for account ${accountId}`);
      return ok({ errors: [], failed: 0, processed: 0 });
    }

    this.logger.debug(`Processing ${rawDataItems.length} pending items for account ${accountId} (${sourceName})`);

    const processingContext = await this.getProcessingContext(account, accountId);
    const normalizedRawDataItems = this.normalizeRawData(rawDataItems, account.accountType);

    const processorResult = this.getProcessor(sourceName, account.accountType);
    if (processorResult.isErr()) {
      return err(processorResult.error);
    }
    const processor = processorResult.value;

    // Process raw data into universal transactions
    const transactionsResult = await processor.process(normalizedRawDataItems, processingContext);

    if (transactionsResult.isErr()) {
      this.logger.error(`CRITICAL: Processing failed for account ${accountId} - ${transactionsResult.error}`);
      return err(
        new Error(
          `Cannot proceed: Account ${accountId} processing failed. ${transactionsResult.error}. ` +
            `This would corrupt portfolio calculations by losing transactions from this account.`
        )
      );
    }

    const transactions = transactionsResult.value;
    this.logger.debug(`Processed ${transactions.length} transactions for account ${accountId}`);

    // Save transactions
    const saveResult = await this.saveTransactions(transactions, accountId);
    if (saveResult.isErr()) {
      return err(saveResult.error);
    }
    const { saved, duplicates } = saveResult.value;

    if (duplicates > 0) {
      this.logger.debug(`Account ${accountId}: ${duplicates} duplicate transactions were skipped during save`);
    }

    // Mark raw data items as processed
    const markResult = await this.markRawDataAsProcessed(rawDataItems);
    if (markResult.isErr()) {
      return err(markResult.error);
    }

    const skippedCount = rawDataItems.length - transactions.length;
    const accountLabel = `Account ${accountId} (${sourceName})`.padEnd(25);
    if (skippedCount > 0) {
      this.logger.info(`• ${accountLabel}: Correlated ${rawDataItems.length} items into ${saved} transactions.`);
    } else {
      this.logger.info(`• ${accountLabel}: Processed ${rawDataItems.length} items.`);
    }

    return ok({
      errors: [],
      failed: 0,
      processed: saved,
    });
  }

  /**
   * Process blockchain account transactions in hash-grouped batches.
   * Groups by blockchain_transaction_hash to ensure all events for the same on-chain transaction
   * are processed together, preventing partial fund-flow and balance mismatches.
   * Processes in bounded batches to avoid loading 100k+ transactions into memory.
   */
  private async processAccountTransactionsChunked(
    accountId: number,
    account: { accountType: string; identifier: string; sourceName: string; userId?: number | undefined }
  ): Promise<Result<ProcessResult, Error>> {
    const sourceName = account.sourceName.toLowerCase();
    let totalSaved = 0;
    let totalProcessed = 0;
    let chunkNumber = 0;

    // Build processing context once (used for all chunks)
    const processingContext = await this.getProcessingContext(account, accountId);

    // Create processor once (reused for all chunks)
    const processorResult = this.getProcessor(sourceName, account.accountType);
    if (processorResult.isErr()) {
      return err(processorResult.error);
    }
    const processor = processorResult.value;

    // Process in hash-grouped batches until no more pending data
    while (true) {
      chunkNumber++;

      const rawDataItemsResult = await this.rawDataRepository.loadPendingByHashBatch(
        accountId,
        RAW_DATA_HASH_BATCH_SIZE
      );

      if (rawDataItemsResult.isErr()) {
        return err(rawDataItemsResult.error);
      }

      const rawDataItems = rawDataItemsResult.value;

      // No more pending data
      if (rawDataItems.length === 0) {
        break;
      }

      this.logger.debug(
        `Processing chunk ${chunkNumber}: ${rawDataItems.length} items for account ${accountId} (${sourceName})`
      );

      const normalizedRawDataItems = this.normalizeRawData(rawDataItems, account.accountType);

      // Process raw data into universal transactions
      const transactionsResult = await processor.process(normalizedRawDataItems, processingContext);

      if (transactionsResult.isErr()) {
        this.logger.error(
          `CRITICAL: Processing failed for account ${accountId} chunk ${chunkNumber} - ${transactionsResult.error}`
        );
        return err(
          new Error(
            `Cannot proceed: Account ${accountId} processing failed at chunk ${chunkNumber}. ${transactionsResult.error}. ` +
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
          `Account ${accountId} chunk ${chunkNumber}: ${duplicates} duplicate blockchain transactions were skipped during save`
        );
      }

      // Mark raw data items as processed
      const markResult = await this.markRawDataAsProcessed(rawDataItems);
      if (markResult.isErr()) {
        return err(markResult.error);
      }

      // Continue until no more pending data (checked at loop start)
    }

    const accountLabel = `Account ${accountId} (${sourceName})`.padEnd(25);
    this.logger.info(`• ${accountLabel}: Processed ${totalProcessed} items in ${chunkNumber} chunks.`);

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
        const userAccountsResult = await this.accountRepository.findByUser(account.userId);
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

  private getProcessor(sourceName: string, sourceType: string): Result<ITransactionProcessor, Error> {
    if (sourceType === 'blockchain') {
      const adapter = getBlockchainAdapter(sourceName);
      if (!adapter) {
        return err(new Error(`Unknown blockchain: ${sourceName}`));
      }
      return adapter.createProcessor(this.providerManager, this.tokenMetadataService, this.scamDetectionService);
    } else {
      const adapter = getExchangeAdapter(sourceName);
      if (!adapter) {
        return err(new Error(`Unknown exchange: ${sourceName}`));
      }
      return ok(adapter.createProcessor());
    }
  }

  private normalizeRawData(rawDataItems: RawTransaction[], sourceType: string): unknown[] {
    const normalizedRawDataItems: unknown[] = [];

    for (const item of rawDataItems) {
      let normalizedData: unknown = item.normalizedData;

      if (!normalizedData || Object.keys(normalizedData as Record<string, never>).length === 0) {
        normalizedData = item.providerData;
      }

      if (sourceType === 'exchange-api' || sourceType === 'exchange-csv') {
        const dataPackage = {
          raw: item.providerData,
          normalized: normalizedData,
          eventId: item.eventId || '',
        };
        normalizedRawDataItems.push(dataPackage);
      } else {
        normalizedRawDataItems.push(normalizedData);
      }
    }
    return normalizedRawDataItems;
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
      const saveResult = await this.transactionRepository.saveBatch(batch, accountId);

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
      const markAsProcessedResult = await this.rawDataRepository.markAsProcessed(batchIds);

      if (markAsProcessedResult.isErr()) {
        return err(markAsProcessedResult.error);
      }
    }
    return ok(undefined);
  }
}
