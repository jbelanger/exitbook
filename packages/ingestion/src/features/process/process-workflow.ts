import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import { formatAccountFingerprintRef, type RawTransaction } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getErrorMessage } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';

import type { IngestionEvent } from '../../events.js';
import type { ProcessingAccountInfo } from '../../ports/account-lookup.js';
import { loadAccountScopeContext, type IAccountScopeHierarchyLookup } from '../../ports/account-scope.js';
import type { AccountingLedgerWrite } from '../../ports/accounting-ledger-sink.js';
import type { ProcessedTransactionWrite } from '../../ports/processed-transaction-sink.js';
import type { ProcessingPorts } from '../../ports/processing-ports.js';
import type { AdapterRegistry } from '../../shared/types/adapter-registry.js';
import { isUtxoAdapter, type UtxoBlockchainAdapter } from '../../shared/types/blockchain-adapter.js';
import type {
  BatchProcessSummary,
  AddressContext,
  BlockchainLedgerProcessorContext,
  IAccountingLedgerProcessor,
  ITransactionProcessor,
} from '../../shared/types/processors.js';
import type { ScamDetector } from '../scam-detection/contracts.js';
import { ScamDetectionService } from '../scam-detection/scam-detection-service.js';

import {
  AllAtOnceBatchProvider,
  HashGroupedBatchProvider,
  NearStreamBatchProvider,
  type IRawDataBatchProvider,
} from './batch-providers/index.js';
import { buildAccountingLedgerWrites, buildProcessedTransactionWrites } from './raw-transaction-lineage.js';
import { createScamBatchReportingDetector } from './scam-detection-reporting.js';

export interface ReprocessPlan {
  accountIds: number[];
}

const TRANSACTION_SAVE_BATCH_SIZE = 500;
const RAW_DATA_MARK_BATCH_SIZE = 500;
const RAW_DATA_HASH_BATCH_SIZE = 100; // For blockchain accounts, process in hash-grouped batches to ensure correlation integrity

type LedgerAddressScope = Pick<
  BlockchainLedgerProcessorContext,
  'primaryAddress' | 'userAddresses' | 'walletAddresses'
>;

type LedgerRawBindingScope = { kind: 'currentBatch' } | { accountIds: readonly number[]; kind: 'walletAccountScope' };

interface LedgerProcessingScope {
  ledgerContext: BlockchainLedgerProcessorContext;
  rawBindingScope: LedgerRawBindingScope;
}

function formatProcessingAccountLabel(account: Pick<ProcessingAccountInfo, 'accountFingerprint' | 'name'>): string {
  if (account.name !== undefined && account.name.trim() !== '') {
    return account.name;
  }

  return formatAccountFingerprintRef(account.accountFingerprint);
}

function buildBlockchainLedgerProcessorContext(
  ownerAccount: Pick<ProcessingAccountInfo, 'accountFingerprint' | 'id'>,
  addressScope: LedgerAddressScope
): BlockchainLedgerProcessorContext {
  return {
    account: {
      fingerprint: ownerAccount.accountFingerprint,
      id: ownerAccount.id,
    },
    primaryAddress: addressScope.primaryAddress,
    userAddresses: addressScope.userAddresses,
    walletAddresses: addressScope.walletAddresses,
  };
}

function buildDefaultLedgerAddressScope(
  account: Pick<ProcessingAccountInfo, 'identifier'>,
  addressContext: AddressContext
): LedgerAddressScope {
  const primaryAddress = addressContext.primaryAddress || account.identifier;
  const userAddresses =
    addressContext.userAddresses.length > 0 ? addressContext.userAddresses : nonEmptyAddressList(primaryAddress);

  return {
    primaryAddress,
    userAddresses,
    walletAddresses: userAddresses,
  };
}

function nonEmptyAddressList(address: string): string[] {
  return address ? [address] : [];
}

function collectUtxoWalletAddresses(
  accounts: readonly Pick<ProcessingAccountInfo, 'identifier'>[],
  adapter: UtxoBlockchainAdapter
): string[] {
  const walletAddresses = accounts
    .map((account) => account.identifier.trim())
    .filter((identifier) => identifier.length > 0 && !adapter.isExtendedPublicKey(identifier));

  return [...new Set(walletAddresses)];
}

function collectRequiredBlockchainTransactionHashes(rawDataItems: readonly RawTransaction[]): Result<string[], Error> {
  const transactionHashes: string[] = [];

  for (const rawDataItem of rawDataItems) {
    const transactionHash = rawDataItem.blockchainTransactionHash?.trim();
    if (!transactionHash) {
      return err(
        new Error(
          `Raw transaction ${rawDataItem.id} is missing blockchain_transaction_hash for wallet-scope ledger binding`
        )
      );
    }

    transactionHashes.push(transactionHash);
  }

  return ok([...new Set(transactionHashes)]);
}

export class ProcessingWorkflow {
  private logger: Logger;
  private scamDetector: ScamDetector;

  constructor(
    private ports: ProcessingPorts,
    private providerRuntime: IBlockchainProviderRuntime,
    private eventBus: EventBus<IngestionEvent>,
    private registry: AdapterRegistry
  ) {
    this.logger = getLogger('ProcessingWorkflow');
    const scamDetectionService = new ScamDetectionService();
    this.scamDetector = scamDetectionService.detectScams.bind(scamDetectionService);
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
      const buildingResult = await this.ports.markProcessedTransactionsBuilding(accountIds);
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
          const accountLabel = await this.getAccountDisplayLabel(accountId);
          const errorMsg = `Failed to process account ${accountLabel}: ${result.error.message}`;
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
        const materializeOverridesResult = await this.ports.transactionOverrides.materializeStoredOverrides({
          accountIds,
        });
        if (materializeOverridesResult.isErr()) return err(materializeOverridesResult.error);

        const interpretationResult = await this.ports.rebuildTransactionInterpretation(accountIds);
        if (interpretationResult.isErr()) {
          const errorMessage = `Processed transactions were rebuilt, but transaction interpretation failed: ${interpretationResult.error.message}`;

          this.eventBus.emit({
            type: 'process.failed',
            accountIds,
            error: errorMessage,
          });

          return err(new Error(errorMessage));
        }

        const freshResult = await this.ports.markProcessedTransactionsFresh(accountIds);
        if (freshResult.isErr()) return err(freshResult.error);

        const assetReviewResult = await this.ports.rebuildAssetReviewProjection(accountIds);
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
        const failedResult = await this.ports.markProcessedTransactionsFailed(accountIds);
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

      const failedResult = await this.ports.markProcessedTransactionsFailed(accountIds);
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
    profileId?: number | undefined;
  }): Promise<Result<ReprocessPlan | undefined, Error>> {
    const { accountId, profileId } = params;

    // 1. Resolve all accounts with raw data
    let accountIds: number[];
    if (accountId) {
      const accountResult = await this.ports.accountLookup.getAccountInfo(accountId);
      if (accountResult.isErr()) {
        return err(new Error(`Failed to load account metadata for reprocess planning: ${accountResult.error.message}`));
      }

      const scopeContextResult = await loadAccountScopeContext(accountResult.value, this.createAccountScopeLookup());
      if (scopeContextResult.isErr()) {
        return err(scopeContextResult.error);
      }

      accountIds = scopeContextResult.value.memberAccounts.map((memberAccount) => memberAccount.id);
    } else {
      const accountIdsResult = await this.ports.batchSource.findAccountsWithRawData(profileId);
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
          const accountLabel = await this.getAccountDisplayLabel(accountId);
          const errorMsg = `Failed to process account ${accountLabel}: ${result.error.message}`;
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
        return err(new Error(`Failed to load account metadata: ${accountResult.error.message}`));
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
      return err(new Error(`Unexpected processing failure: ${errorMessage}`));
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
      const affectedAccounts = await Promise.all(
        incompleteSessions.map(
          async (session) => `${await this.getAccountDisplayLabel(session.accountId)}(${session.status})`
        )
      );
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

  private async getAccountDisplayLabel(accountId: number): Promise<string> {
    const accountResult = await this.ports.accountLookup.getAccountInfo(accountId);
    if (accountResult.isErr()) {
      this.logger.warn(
        { accountId, error: accountResult.error },
        'Failed to load account label for processing message; using generic fallback'
      );
      return 'unknown-account';
    }

    return formatProcessingAccountLabel(accountResult.value);
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
    account: ProcessingAccountInfo,
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
    const processorResult = this.createProcessor(platformKey, account.accountType);
    if (processorResult.isErr()) {
      return err(processorResult.error);
    }
    const processor = processorResult.value;
    const ledgerProcessorResult = this.createLedgerProcessor(platformKey, account.accountType);
    if (ledgerProcessorResult.isErr()) {
      return err(ledgerProcessorResult.error);
    }
    const ledgerProcessor = ledgerProcessorResult.value;
    let ledgerProcessingScope: LedgerProcessingScope | undefined;
    if (ledgerProcessor !== undefined) {
      const ledgerProcessingScopeResult = await this.buildLedgerProcessingScope(account, addressContext);
      if (ledgerProcessingScopeResult.isErr()) {
        return err(ledgerProcessingScopeResult.error);
      }
      ledgerProcessingScope = ledgerProcessingScopeResult.value;
    }

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
      const transactionWritesResult = buildProcessedTransactionWrites({
        platformKey,
        platformKind: account.accountType,
        rawTransactions: rawDataItems,
        transactions,
      });
      if (transactionWritesResult.isErr()) {
        this.logger.error(
          `CRITICAL: Failed to bind raw lineage for account ${accountId} batch ${batchNumber} - ${transactionWritesResult.error.message}`
        );
        return err(
          new Error(
            `Cannot proceed: Account ${accountId} lineage binding failed at batch ${batchNumber}. ` +
              `${transactionWritesResult.error.message}. This would lose source provenance for processed transactions.`
          )
        );
      }

      const transactionWrites = transactionWritesResult.value;
      const ledgerWritesResult = await this.buildAccountingLedgerShadowWrites({
        accountId,
        batchNumber,
        ledgerProcessor,
        ledgerProcessingScope,
        platformKind: account.accountType,
        processorInputs,
        rawDataItems,
      });
      if (ledgerWritesResult.isErr()) {
        return err(ledgerWritesResult.error);
      }
      const ledgerWrites = ledgerWritesResult.value;
      totalProcessed += rawDataItems.length;

      // Atomically: save processed transactions + mark raw data as processed
      const commitResult = await this.ports.withTransaction(async (tx) => {
        const saveResult = await this.saveTransactionsWithPorts(tx, transactionWrites, accountId);
        if (saveResult.isErr()) return err(saveResult.error);

        if (ledgerWrites.length > 0) {
          const ledgerResult = await tx.accountingLedgerSink.replaceSourceActivities(ledgerWrites);
          if (ledgerResult.isErr()) {
            return err(ledgerResult.error);
          }
        }

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
    account: Pick<ProcessingAccountInfo, 'accountType' | 'identifier' | 'platformKey' | 'profileId'>,
    accountId: number
  ): Promise<AddressContext> {
    const addressContext: AddressContext = {
      accountId,
      primaryAddress: '',
      userAddresses: [],
    };

    if (account.accountType === 'blockchain') {
      addressContext.primaryAddress = account.identifier;

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
    return addressContext;
  }

  private async buildLedgerProcessingScope(
    account: ProcessingAccountInfo,
    addressContext: AddressContext
  ): Promise<Result<LedgerProcessingScope, Error>> {
    const defaultAddressScope = buildDefaultLedgerAddressScope(account, addressContext);

    if (account.accountType !== 'blockchain') {
      return ok({
        ledgerContext: buildBlockchainLedgerProcessorContext(account, defaultAddressScope),
        rawBindingScope: { kind: 'currentBatch' },
      });
    }

    const adapterResult = this.registry.getBlockchain(account.platformKey.toLowerCase());
    if (adapterResult.isErr()) {
      return err(adapterResult.error);
    }

    const adapter = adapterResult.value;
    if (!isUtxoAdapter(adapter)) {
      return ok({
        ledgerContext: buildBlockchainLedgerProcessorContext(account, defaultAddressScope),
        rawBindingScope: { kind: 'currentBatch' },
      });
    }

    const scopeContextResult = await loadAccountScopeContext(account, this.createAccountScopeLookup());
    if (scopeContextResult.isErr()) {
      return err(scopeContextResult.error);
    }

    const scopeContext = scopeContextResult.value;
    const walletAddresses = collectUtxoWalletAddresses(scopeContext.memberAccounts, adapter);
    const firstWalletAddress = walletAddresses[0];
    if (firstWalletAddress === undefined) {
      return err(
        new Error(
          `UTXO ledger shadow scope for account ${account.id} (${account.platformKey}) has no derived wallet addresses`
        )
      );
    }

    const requestedIdentifier = account.identifier.trim();
    const ledgerPrimaryAddress =
      requestedIdentifier.length > 0 && !adapter.isExtendedPublicKey(requestedIdentifier)
        ? requestedIdentifier
        : firstWalletAddress;

    return ok({
      ledgerContext: buildBlockchainLedgerProcessorContext(scopeContext.scopeAccount, {
        primaryAddress: ledgerPrimaryAddress,
        userAddresses: walletAddresses,
        walletAddresses,
      }),
      rawBindingScope: {
        accountIds: scopeContext.memberAccounts.map((memberAccount) => memberAccount.id),
        kind: 'walletAccountScope',
      },
    });
  }

  private createAccountScopeLookup(): IAccountScopeHierarchyLookup<ProcessingAccountInfo> {
    return {
      findById: async (id) => {
        const accountResult = await this.ports.accountLookup.getAccountInfo(id);
        if (accountResult.isErr()) {
          return err(accountResult.error);
        }

        return ok(accountResult.value);
      },
      findChildAccounts: (parentAccountId) => this.ports.accountLookup.findChildAccounts(parentAccountId),
    };
  }

  private createProcessor(platformKey: string, platformKind: string): Result<ITransactionProcessor, Error> {
    if (platformKind === 'blockchain') {
      const adapterResult = this.registry.getBlockchain(platformKey);
      if (adapterResult.isErr()) {
        return err(adapterResult.error);
      }

      return ok(
        adapterResult.value.createProcessor({
          providerRuntime: this.providerRuntime,
          scamDetector: createScamBatchReportingDetector({
            blockchain: platformKey,
            detector: this.scamDetector,
            emit: (event) => this.eventBus.emit(event),
          }),
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

  private createLedgerProcessor(
    platformKey: string,
    platformKind: string
  ): Result<IAccountingLedgerProcessor | undefined, Error> {
    if (platformKind !== 'blockchain') {
      return ok(undefined);
    }

    const adapterResult = this.registry.getBlockchain(platformKey);
    if (adapterResult.isErr()) {
      return err(adapterResult.error);
    }

    const createLedgerProcessor = adapterResult.value.createLedgerProcessor;
    if (!createLedgerProcessor) {
      return ok(undefined);
    }

    return ok(
      createLedgerProcessor({
        providerRuntime: this.providerRuntime,
        scamDetector: createScamBatchReportingDetector({
          blockchain: platformKey,
          detector: this.scamDetector,
          emit: (event) => this.eventBus.emit(event),
        }),
      })
    );
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
    transactions: ProcessedTransactionWrite[],
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

  private async buildAccountingLedgerShadowWrites(params: {
    accountId: number;
    batchNumber: number;
    ledgerProcessingScope: LedgerProcessingScope | undefined;
    ledgerProcessor: IAccountingLedgerProcessor | undefined;
    platformKind: string;
    processorInputs: unknown[];
    rawDataItems: RawTransaction[];
  }): Promise<Result<AccountingLedgerWrite[], Error>> {
    if (!params.ledgerProcessor) {
      return ok([]);
    }
    const ledgerProcessingScope = params.ledgerProcessingScope;
    if (ledgerProcessingScope === undefined) {
      return err(new Error(`Ledger v2 shadow scope missing for account ${params.accountId}`));
    }

    const ledgerRawDataResult = await this.loadRawDataForLedgerShadow({
      accountId: params.accountId,
      batchNumber: params.batchNumber,
      ledgerProcessingScope,
      rawDataItems: params.rawDataItems,
    });
    if (ledgerRawDataResult.isErr()) {
      return err(ledgerRawDataResult.error);
    }

    const ledgerRawDataItems = ledgerRawDataResult.value;
    const ledgerProcessorInputsResult =
      ledgerRawDataItems === params.rawDataItems
        ? ok(params.processorInputs)
        : this.unpackForProcessor(ledgerRawDataItems, params.platformKind);
    if (ledgerProcessorInputsResult.isErr()) {
      return err(
        new Error(
          `Cannot proceed: Account ${params.accountId} ledger v2 raw scope normalization failed at batch ${params.batchNumber}. ` +
            `${ledgerProcessorInputsResult.error.message}. This would leave ledger lineage incomplete.`
        )
      );
    }

    const ledgerDraftsResult = await params.ledgerProcessor.process(
      ledgerProcessorInputsResult.value,
      ledgerProcessingScope.ledgerContext
    );
    if (ledgerDraftsResult.isErr()) {
      this.logger.error(
        `CRITICAL: Ledger v2 shadow processing failed for account ${params.accountId} batch ${params.batchNumber} - ${ledgerDraftsResult.error.message}`
      );
      return err(
        new Error(
          `Cannot proceed: Account ${params.accountId} ledger v2 shadow processing failed at batch ${params.batchNumber}. ` +
            `${ledgerDraftsResult.error.message}. This would leave the legacy and ledger projections out of sync.`
        )
      );
    }

    const ledgerWritesResult = buildAccountingLedgerWrites({
      ledgerDrafts: ledgerDraftsResult.value,
      platformKind: params.platformKind,
      rawTransactions: ledgerRawDataItems,
    });
    if (ledgerWritesResult.isErr()) {
      this.logger.error(
        `CRITICAL: Failed to bind ledger v2 raw lineage for account ${params.accountId} batch ${params.batchNumber} - ${ledgerWritesResult.error.message}`
      );
      return err(
        new Error(
          `Cannot proceed: Account ${params.accountId} ledger v2 lineage binding failed at batch ${params.batchNumber}. ` +
            `${ledgerWritesResult.error.message}. This would lose source provenance for ledger source activities.`
        )
      );
    }

    return ok(ledgerWritesResult.value);
  }

  private async loadRawDataForLedgerShadow(params: {
    accountId: number;
    batchNumber: number;
    ledgerProcessingScope: LedgerProcessingScope;
    rawDataItems: RawTransaction[];
  }): Promise<Result<RawTransaction[], Error>> {
    const rawBindingScope = params.ledgerProcessingScope.rawBindingScope;

    if (rawBindingScope.kind === 'currentBatch') {
      return ok(params.rawDataItems);
    }

    const transactionHashesResult = collectRequiredBlockchainTransactionHashes(params.rawDataItems);
    if (transactionHashesResult.isErr()) {
      return err(
        new Error(
          `Cannot proceed: Account ${params.accountId} ledger v2 wallet-scope binding failed at batch ${params.batchNumber}. ` +
            `${transactionHashesResult.error.message}`
        )
      );
    }

    const scopedRawDataResult = await this.ports.batchSource.fetchByTransactionHashesForAccounts(
      rawBindingScope.accountIds,
      transactionHashesResult.value
    );
    if (scopedRawDataResult.isErr()) {
      return err(scopedRawDataResult.error);
    }

    const scopedRawData = scopedRawDataResult.value;
    const scopedRawDataIds = new Set(scopedRawData.map((rawDataItem) => rawDataItem.id));
    const missingCurrentBatchIds = params.rawDataItems
      .map((rawDataItem) => rawDataItem.id)
      .filter((rawDataId) => !scopedRawDataIds.has(rawDataId));
    if (missingCurrentBatchIds.length > 0) {
      return err(
        new Error(
          `Ledger v2 wallet-scope raw lookup did not return current batch raw ids: ${missingCurrentBatchIds.join(', ')}`
        )
      );
    }

    return ok(scopedRawData);
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
