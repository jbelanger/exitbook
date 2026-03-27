import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { RawTransaction } from '@exitbook/core';
import type { TransactionDraft } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getErrorMessage } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';

import type { IngestionEvent } from '../../events.js';
import type { ProcessingPorts } from '../../ports/processing-ports.js';
import type { AdapterRegistry } from '../../shared/types/adapter-registry.js';
import type { BatchProcessSummary, AddressContext, ITransactionProcessor } from '../../shared/types/processors.js';
import type { IScamDetectionService } from '../scam-detection/contracts.js';
import { ScamDetectionService } from '../scam-detection/scam-detection-service.js';

import {
  AllAtOnceBatchProvider,
  HashGroupedBatchProvider,
  NearStreamBatchProvider,
  type IRawDataBatchProvider,
} from './batch-providers/index.js';

export interface ReprocessPlan {
  accountIds: number[];
}

const TRANSACTION_SAVE_BATCH_SIZE = 500;
const RAW_DATA_MARK_BATCH_SIZE = 500;
const RAW_DATA_HASH_BATCH_SIZE = 100; // For blockchain accounts, process in hash-grouped batches to ensure correlation integrity

export class ProcessingWorkflow {
  private logger: Logger;
  private scamDetectionService: IScamDetectionService;

  constructor(
    private ports: ProcessingPorts,
    private providerRuntime: IBlockchainProviderRuntime,
    private eventBus: EventBus<IngestionEvent>,
    private registry: AdapterRegistry
  ) {
    this.logger = getLogger('ProcessingWorkflow');
    this.scamDetectionService = new ScamDetectionService(eventBus);
  }

  /**
   * Process imported sessions from import operation.
   * Emits process.started and process.completed events for dashboard coordination.
   */
  async processImportedSessions(accountIds: number[]): Promise<Result<BatchProcessSummary, Error>> {
    if (accountIds.length === 0) {
      return ok({ errors: [], failed: 0, processed: 0 });
    }

    const startTime = Date.now();
    try {
      // Mark projection as building — fail-fast
      const buildingResult = await this.ports.markProcessedTransactionsBuilding();
      if (buildingResult.isErr()) return err(buildingResult.error);

      // Count total raw data to process and collect transaction counts by stream type
      let totalRaw = 0;
      const accountTransactionCounts = new Map<number, Map<string, number>>();

      for (const accountId of accountIds) {
        const countResult = await this.ports.batchSource.countPending(accountId);
        if (countResult.isOk()) {
          totalRaw += countResult.value;
        }

        // Fetch transaction counts by stream type for dashboard display
        const streamCountsResult = await this.ports.batchSource.countPendingByStreamType(accountId);
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

      // Process each account, collecting errors so one bad account doesn't block the rest
      let totalProcessed = 0;
      let totalFailed = 0;
      const allErrors: string[] = [];

      for (const accountId of accountIds) {
        const result = await this.processAccountTransactions(accountId);

        if (result.isErr()) {
          const errorMsg = `Failed to process account ${accountId}: ${result.error.message}`;
          this.logger.error(errorMsg);
          allErrors.push(errorMsg);
          totalFailed++;
          continue;
        }

        totalProcessed += result.value.processed;
        allErrors.push(...result.value.errors);
      }

      // Mark projection fresh + cascade-invalidate downstream, or failed
      if (totalFailed === 0) {
        const materializeNotesResult = await this.ports.transactionNotes.materializeStoredNotes({ accountIds });
        if (materializeNotesResult.isErr()) return err(materializeNotesResult.error);

        const freshResult = await this.ports.markProcessedTransactionsFresh(accountIds);
        if (freshResult.isErr()) return err(freshResult.error);

        const assetReviewResult = await this.ports.rebuildAssetReviewProjection();
        if (assetReviewResult.isErr()) {
          const errorMessage = `Processed transactions were rebuilt, but asset review projection failed: ${assetReviewResult.error.message}`;

          this.eventBus.emit({
            type: 'process.failed',
            accountIds,
            error: errorMessage,
          });

          return err(new Error(errorMessage));
        }
      } else {
        const failedResult = await this.ports.markProcessedTransactionsFailed();
        if (failedResult.isErr()) {
          this.logger.warn({ error: failedResult.error }, 'Failed to mark processed-transactions as failed');
        }
      }

      // Emit process.completed event (even if some accounts failed)
      this.eventBus.emit({
        type: 'process.completed',
        accountIds,
        durationMs: Date.now() - startTime,
        totalProcessed,
        errors: allErrors,
      });

      return ok({
        errors: allErrors,
        failed: totalFailed,
        processed: totalProcessed,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`Unexpected error processing imported sessions: ${errorMessage}`);

      const failedResult = await this.ports.markProcessedTransactionsFailed();
      if (failedResult.isErr()) {
        this.logger.warn({ error: failedResult.error }, 'Failed to mark processed-transactions as failed');
      }

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
   * Validate and plan a reprocess run without mutating any data.
   *
   * Resolves target accounts, checks for raw data, and guards against
   * incomplete imports. Returns a plan the caller uses to orchestrate
   * cross-capability resets before calling `processImportedSessions()`.
   *
   * Returns `undefined` when there is nothing to reprocess.
   */
  async prepareReprocess(params: {
    accountId?: number | undefined;
  }): Promise<Result<ReprocessPlan | undefined, Error>> {
    const { accountId } = params;

    // 1. Resolve all accounts with raw data
    let accountIds: number[];
    if (accountId) {
      accountIds = [accountId];
    } else {
      const accountIdsResult = await this.ports.batchSource.findAccountsWithRawData();
      if (accountIdsResult.isErr()) return err(accountIdsResult.error);
      accountIds = accountIdsResult.value;

      if (accountIds.length === 0) {
        this.logger.info('No raw data found to process');
        return ok(undefined);
      }
    }

    // 2. Guard: abort before any mutation if any account has an incomplete import
    const guardResult = await this.assertNoIncompleteImports(accountIds);
    if (guardResult.isErr()) return err(guardResult.error);

    return ok({ accountIds });
  }

  /**
   * Process all accounts that have pending raw data.
   */
  async processAllPending(): Promise<Result<BatchProcessSummary, Error>> {
    this.logger.info('Processing all accounts with pending records');

    try {
      const accountIdsResult = await this.ports.batchSource.findAccountsWithPendingData();
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
      const incompleteImportsGuard = await this.assertNoIncompleteImports(accountIds);
      if (incompleteImportsGuard.isErr()) {
        return err(incompleteImportsGuard.error);
      }

      // Process each account, collecting errors so one bad account doesn't block the rest
      let totalProcessed = 0;
      let totalFailed = 0;
      const allErrors: string[] = [];

      for (const accountId of accountIds) {
        const result = await this.processAccountTransactions(accountId);

        if (result.isErr()) {
          const errorMsg = `Failed to process account ${accountId}: ${result.error.message}`;
          this.logger.error(errorMsg);
          allErrors.push(errorMsg);
          totalFailed++;
          continue;
        }

        totalProcessed += result.value.processed;
        allErrors.push(...result.value.errors);
      }

      this.logger.debug(`Completed processing all accounts: ${totalProcessed} transactions processed`);

      return ok({
        errors: allErrors,
        failed: totalFailed,
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
  async processAccountTransactions(accountId: number): Promise<Result<BatchProcessSummary, Error>> {
    try {
      // CRITICAL: Check for active import before processing to prevent data corruption
      const activeImportsCheck = await this.assertNoIncompleteImports([accountId]);
      if (activeImportsCheck.isErr()) {
        return err(activeImportsCheck.error);
      }

      // Load account to get source information
      const accountResult = await this.ports.accountLookup.getAccountInfo(accountId);
      if (accountResult.isErr()) {
        return err(new Error(`Failed to load account ${accountId}: ${accountResult.error.message}`));
      }

      const account = accountResult.value;
      const platformKind = account.accountType;
      const platformKey = account.platformKey;

      // Choose batch provider based on source type
      const batchProvider = this.createBatchProvider(platformKind, platformKey, accountId);

      // Process using batch provider
      return this.processAccountWithBatchProvider(accountId, account, batchProvider);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error(`CRITICAL: Unexpected processing failure for account ${accountId}: ${errorMessage}`);
      return err(new Error(`Unexpected processing failure for account ${accountId}: ${errorMessage}`));
    }
  }

  /**
   * Check for active imports (status='started') across specified accounts.
   * CRITICAL: This prevents processing incomplete data from in-progress imports.
   *
   * @param accountIds - Account IDs to check for active imports
   * @returns Error if any active imports found, ok otherwise
   */
  async assertNoIncompleteImports(accountIds: number[]): Promise<Result<void, Error>> {
    if (accountIds.length === 0) {
      return ok(undefined);
    }

    const sessionsResult = await this.ports.importSessionLookup.findLatestSessionPerAccount(accountIds);
    if (sessionsResult.isErr()) {
      return err(new Error(`Failed to check for active imports: ${sessionsResult.error.message}`));
    }

    const incompleteSessions = sessionsResult.value.filter((session) => session.status !== 'completed');

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

  /**
   * Create appropriate batch provider based on source type and name.
   */
  private createBatchProvider(platformKind: string, platformKey: string, accountId: number): IRawDataBatchProvider {
    // NEAR requires special multi-stream batch provider
    if (platformKind === 'blockchain' && platformKey.toLowerCase() === 'near') {
      return new NearStreamBatchProvider(this.ports.nearBatchSource, accountId, RAW_DATA_HASH_BATCH_SIZE);
    }

    if (platformKind === 'blockchain') {
      // Hash-grouped batching for blockchains to ensure correlation integrity
      return new HashGroupedBatchProvider(this.ports.batchSource, accountId, RAW_DATA_HASH_BATCH_SIZE);
    }

    // All-at-once batching for exchanges (manageable data volumes)
    return new AllAtOnceBatchProvider(this.ports.batchSource, accountId);
  }

  /**
   * Process account transactions using a batch provider.
   * Handles both exchange (all-at-once) and blockchain (hash-grouped) processing.
   */
  private async processAccountWithBatchProvider(
    accountId: number,
    account: { accountType: string; identifier: string; platformKey: string; profileId?: number | undefined },
    batchProvider: IRawDataBatchProvider
  ): Promise<Result<BatchProcessSummary, Error>> {
    const platformKey = account.platformKey.toLowerCase();
    let totalSaved = 0;
    let totalProcessed = 0;
    let batchNumber = 0;

    // Query pending count once at start
    const pendingCountResult = await this.ports.batchSource.countPending(accountId);
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
    const addressContext = await this.buildAddressContext(account, accountId);

    // Create processor once (reused for all batches)
    const processorResult = this.createProcessor(platformKey, account.accountType, accountId);
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
        `Processing batch ${batchNumber}: ${rawDataItems.length} items for account ${accountId} (${platformKey})`
      );

      const processorInputsResult = this.unpackForProcessor(rawDataItems, account.accountType);
      if (processorInputsResult.isErr()) {
        this.logger.error(
          `CRITICAL: Failed to normalize raw data for account ${accountId} batch ${batchNumber} - ${processorInputsResult.error.message}`
        );
        return err(
          new Error(
            `Cannot proceed: Account ${accountId} processing failed at batch ${batchNumber}. ${processorInputsResult.error.message}. ` +
              `This would corrupt portfolio calculations by losing transactions from this account.`
          )
        );
      }
      const processorInputs = processorInputsResult.value;

      // Process raw data into transactions
      const transactionsResult = await processor.process(processorInputs, addressContext);

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

      // Atomically: save processed transactions + mark raw data as processed
      const commitResult = await this.ports.withTransaction(async (tx) => {
        const saveResult = await this.saveTransactionsWithPorts(tx, transactions, accountId);
        if (saveResult.isErr()) return err(saveResult.error);

        const markResult = await this.markRawDataAsProcessedWithPorts(tx, rawDataItems);
        if (markResult.isErr()) return err(markResult.error);

        return ok(saveResult.value);
      });

      if (commitResult.isErr()) {
        return err(commitResult.error);
      }
      const { saved, duplicates } = commitResult.value;

      totalSaved += saved;

      if (duplicates > 0) {
        this.logger.debug(
          `Account ${accountId} batch ${batchNumber}: ${duplicates} duplicate transactions were skipped during save`
        );
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

    const accountLabel = `Account ${accountId} (${platformKey})`.padEnd(25);

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

  private async buildAddressContext(
    account: { accountType: string; identifier: string; platformKey: string; profileId?: number | undefined },
    accountId: number
  ): Promise<AddressContext> {
    const addressContext: AddressContext = {
      primaryAddress: '',
      userAddresses: [],
    };

    if (account.accountType === 'blockchain') {
      addressContext.primaryAddress = account.identifier;

      if (account.profileId) {
        const userAddressesResult = await this.ports.accountLookup.getProfileAddresses(
          account.profileId,
          account.platformKey
        );
        if (userAddressesResult.isOk() && userAddressesResult.value.length > 0) {
          addressContext.userAddresses = userAddressesResult.value;
          this.logger.debug(
            `Account ${accountId}: Augmented context with ${userAddressesResult.value.length} user addresses for multi-address fund-flow analysis`
          );
        }
      }
    }
    return addressContext;
  }

  private createProcessor(
    platformKey: string,
    platformKind: string,
    accountId: number
  ): Result<ITransactionProcessor, Error> {
    if (platformKind === 'blockchain') {
      const adapterResult = this.registry.getBlockchain(platformKey);
      if (adapterResult.isErr()) {
        return err(adapterResult.error);
      }

      return ok(
        adapterResult.value.createProcessor({
          providerRuntime: this.providerRuntime,
          scamDetectionService: this.scamDetectionService,
          nearBatchSource: this.ports.nearBatchSource,
          accountId,
        })
      );
    } else {
      const adapterResult = this.registry.getExchange(platformKey);
      if (adapterResult.isErr()) {
        return err(adapterResult.error);
      }
      return ok(adapterResult.value.createProcessor());
    }
  }

  private unpackForProcessor(rawDataItems: RawTransaction[], platformKind: string): Result<unknown[], Error> {
    const processorInputs: unknown[] = [];
    const isExchange = platformKind === 'exchange-api' || platformKind === 'exchange-csv';

    for (const item of rawDataItems) {
      if (isExchange) {
        // Exchange processors normalize from raw data via normalizeEntry
        processorInputs.push({
          raw: item.providerData,
          eventId: item.eventId || '',
        });
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

        // Chain-specific schema validation happens inside each processor via BaseTransactionProcessor.
        processorInputs.push(normalizedData);
      }
    }

    return ok(processorInputs);
  }

  private async saveTransactionsWithPorts(
    ports: ProcessingPorts,
    transactions: TransactionDraft[],
    accountId: number
  ): Promise<Result<{ duplicates: number; saved: number }, Error>> {
    let savedCount = 0;
    let duplicateCount = 0;

    this.logger.debug(`Saving ${transactions.length} processed transactions...`);

    for (let start = 0; start < transactions.length; start += TRANSACTION_SAVE_BATCH_SIZE) {
      const batch = transactions.slice(start, start + TRANSACTION_SAVE_BATCH_SIZE);
      const saveResult = await ports.transactionSink.saveProcessedBatch(batch, accountId);

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

  private async markRawDataAsProcessedWithPorts(
    ports: ProcessingPorts,
    rawDataItems: { id: number }[]
  ): Promise<Result<void, Error>> {
    const allRawDataIds = rawDataItems.map((item) => item.id);
    for (let start = 0; start < allRawDataIds.length; start += RAW_DATA_MARK_BATCH_SIZE) {
      const batchIds = allRawDataIds.slice(start, start + RAW_DATA_MARK_BATCH_SIZE);
      const markAsProcessedResult = await ports.batchSource.markProcessed(batchIds);

      if (markAsProcessedResult.isErr()) {
        return err(markAsProcessedResult.error);
      }
    }
    return ok(undefined);
  }
}
