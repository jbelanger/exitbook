import { getErrorMessage } from '@exitbook/core';
import type { AccountRepository, IRawDataRepository, ITransactionRepository } from '@exitbook/data';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { err, ok, Result } from 'neverthrow';

import { getBlockchainAdapter } from '../infrastructure/blockchains/index.js';
import { createExchangeProcessor } from '../infrastructure/exchanges/shared/exchange-processor-factory.js';
import type { ITokenMetadataService } from '../services/token-metadata/token-metadata-service.interface.js';
import type { ProcessingContext, ProcessResult } from '../types/processors.js';

import { extractUniqueAccountIds } from './process-service-utils.js';

export class TransactionProcessService {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private accountRepository: AccountRepository,
    private transactionRepository: ITransactionRepository,
    private tokenMetadataService: ITokenMetadataService
  ) {
    this.logger = getLogger('TransactionProcessService');
  }

  /**
   * Process all accounts that have pending raw data.
   */
  async processAllPending(): Promise<Result<ProcessResult, Error>> {
    this.logger.info('Processing all accounts with pending records');

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

      this.logger.info(`Found ${pendingData.length} pending records across all accounts`);

      // Extract unique account IDs with pending data
      const accountIds = extractUniqueAccountIds(pendingData);

      this.logger.info(`Found ${accountIds.length} accounts with pending records`);

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

      this.logger.info(`Completed processing all accounts: ${totalProcessed} transactions processed`);

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
      const sourceName = account.sourceName.toLowerCase();
      const sourceType = account.accountType;

      this.logger.info(`Processing account ${accountId}: ${account.sourceName} (${sourceType})`);

      // Load all pending raw data for this account
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

      this.logger.info(`Found ${rawDataItems.length} pending items for account ${accountId}`);

      // Build processing context for blockchain processors
      // For blockchain accounts, include primary address and user addresses for fund-flow analysis
      const processingContext: ProcessingContext = {
        primaryAddress: '',
        userAddresses: [],
      };

      if (sourceType === 'blockchain') {
        // Set the primary address (the account being processed)
        processingContext.primaryAddress = account.identifier;

        // For blockchain accounts, augment context with all user addresses for fund-flow analysis
        // This enables processors to distinguish internal transfers (between user's own accounts)
        // from external transfers (to/from third parties)
        if (account.userId) {
          const userAccountsResult = await this.accountRepository.findByUser(account.userId);
          if (userAccountsResult.isOk()) {
            const userAccounts = userAccountsResult.value;
            // Get all addresses for this blockchain from the user's accounts (including current account)
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

      // Prepare raw data items for processing
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
        const adapter = getBlockchainAdapter(sourceName);
        if (!adapter) {
          return err(new Error(`Unknown blockchain: ${sourceName}`));
        }
        const processorResult = adapter.createProcessor(this.tokenMetadataService);
        if (processorResult.isErr()) {
          return err(processorResult.error);
        }
        processor = processorResult.value;
      } else {
        const processorResult = await createExchangeProcessor(sourceName);
        if (processorResult.isErr()) {
          return err(processorResult.error);
        }
        processor = processorResult.value;
      }

      this.logger.info('Transforming transactions...');

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

      // Save transactions to database
      this.logger.info(`Saving ${transactions.length} processed transactions...`);
      const saveResults = await Promise.all(
        transactions.map((transaction) => this.transactionRepository.save(transaction, accountId))
      );

      const combinedResult = Result.combineWithAllErrors(saveResults);
      if (combinedResult.isErr()) {
        const errors = combinedResult.error;
        const failed = errors.length;
        const errorMessages = errors.map((err, index) => {
          const txId = `index-${index}`;
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

      // Mark raw data items as processed
      const allRawDataIds = rawDataItems.map((item) => item.id);
      const markAsProcessedResult = await this.rawDataRepository.markAsProcessed(allRawDataIds);

      if (markAsProcessedResult.isErr()) {
        return err(markAsProcessedResult.error);
      }

      const skippedCount = rawDataItems.length - transactions.length;
      if (skippedCount > 0) {
        this.logger.info(`${skippedCount} items were processed but skipped (likely non-standard operation types)`);
      }

      this.logger.info(`Processing completed for account ${accountId}: ${savedCount} transactions processed`);

      return ok({
        errors: [],
        failed: 0,
        processed: savedCount,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`CRITICAL: Unexpected processing failure for account ${accountId}: ${errorMessage}`);
      return err(new Error(`Unexpected processing failure for account ${accountId}: ${errorMessage}`));
    }
  }
}
