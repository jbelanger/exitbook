import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { Account, ImportSession } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { IngestionEvent, ImportEvent } from '../../events.js';
import type { ImportPorts } from '../../ports/import-ports.js';
import type { AdapterRegistry } from '../../shared/types/adapter-registry.js';
import { isUtxoAdapter, type UtxoBlockchainAdapter } from '../../shared/types/blockchain-adapter.js';
import type { IImporter, StreamingImportParams } from '../../shared/types/importers.js';

export interface ImportParams {
  accountId: number;
}

export interface ImportResult {
  sessions: ImportSession[];
}

const logger = getLogger('ImportWorkflow');

/**
 * Owns the full import lifecycle:
 * load account -> create/resume session ->
 * drive IImporter.importStreaming() -> persist batches -> finalize session.
 *
 * Persistence accessed through ImportPorts — capability-owned contracts.
 */
export class ImportWorkflow {
  private abortController = new AbortController();

  constructor(
    private readonly ports: ImportPorts,
    private readonly providerRuntime: IBlockchainProviderRuntime,
    private readonly registry: AdapterRegistry,
    private readonly eventBus?: EventBus<IngestionEvent> | undefined
  ) {}

  async execute(params: ImportParams): Promise<Result<ImportResult, Error>> {
    const accountResult = await this.loadAccount(params.accountId);
    if (accountResult.isErr()) {
      return err(accountResult.error);
    }

    return this.executeAccount(accountResult.value);
  }

  abort(): void {
    this.abortController.abort();
  }

  private async loadAccount(accountId: number): Promise<Result<Account, Error>> {
    const accountResult = await this.ports.findAccountById(accountId);
    if (accountResult.isErr()) {
      return err(accountResult.error);
    }
    if (!accountResult.value) {
      return err(new Error(`Account ${accountId} not found`));
    }

    return ok(accountResult.value);
  }

  private async executeAccount(account: Account): Promise<Result<ImportResult, Error>> {
    logger.debug(
      { accountId: account.id, accountType: account.accountType, platformKey: account.platformKey },
      'Starting account import'
    );

    if (account.accountType === 'blockchain' && account.parentAccountId === undefined) {
      const adapterResult = this.registry.getBlockchain(account.platformKey.toLowerCase());
      if (adapterResult.isErr()) {
        return err(adapterResult.error);
      }

      const adapter = adapterResult.value;
      if (isUtxoAdapter(adapter) && adapter.isExtendedPublicKey(account.identifier)) {
        return this.importFromXpubAccount(account, adapter);
      }
    }

    const sessionResult = await this.importFromSource(account);
    if (sessionResult.isErr()) {
      return err(sessionResult.error);
    }

    return ok({ sessions: [sessionResult.value] });
  }

  private async importFromXpubAccount(
    parentAccount: Account,
    blockchainAdapter: UtxoBlockchainAdapter
  ): Promise<Result<ImportResult, Error>> {
    const startTime = Date.now();
    const requestedGap = parentAccount.metadata?.xpub?.gapLimit ?? 20;
    const blockchain = parentAccount.platformKey;
    const xpub = parentAccount.identifier;
    const providerName = parentAccount.providerName;

    logger.debug(`Processing xpub import for ${blockchain}`);

    const existingChildrenResult = await this.ports.findAccounts({ parentAccountId: parentAccount.id });
    if (existingChildrenResult.isErr()) return err(existingChildrenResult.error);

    const existingChildren = existingChildrenResult.value;
    const existingChildrenByIdentifier = new Map(
      existingChildren.map((childAccount) => [childAccount.identifier, childAccount])
    );
    const hasExistingChildren = existingChildren.length > 0;
    const hasExistingMetadata = parentAccount.metadata?.xpub !== undefined;
    const parentAlreadyExists = hasExistingChildren || hasExistingMetadata;

    const existingMetadata = parentAccount.metadata?.xpub;
    const shouldRederive =
      !hasExistingChildren || existingMetadata === undefined || requestedGap > existingMetadata.gapLimit;

    let childAccounts: Account[];
    let newlyDerivedCount = 0;

    if (shouldRederive) {
      this.emit({
        type: 'xpub.derivation.started',
        parentAccountId: parentAccount.id,
        blockchain,
        gapLimit: requestedGap,
        isRederivation: Boolean(existingMetadata),
        parentIsNew: !parentAlreadyExists,
        previousGap: existingMetadata?.gapLimit,
      });

      const derivedAddressesResult = await blockchainAdapter.deriveAddressesFromXpub(
        xpub,
        this.providerRuntime,
        blockchain,
        requestedGap
      );
      if (derivedAddressesResult.isErr()) {
        const durationMs = Date.now() - startTime;
        this.emit({
          type: 'xpub.derivation.failed',
          parentAccountId: parentAccount.id,
          error: derivedAddressesResult.error.message,
          durationMs,
        });
        return wrapError(derivedAddressesResult.error, 'Failed to derive addresses from xpub');
      }
      const derivedAddresses = derivedAddressesResult.value;
      const derivationDuration = Date.now() - startTime;

      if (derivedAddresses.length === 0) {
        this.emit({
          type: 'xpub.derivation.completed',
          parentAccountId: parentAccount.id,
          derivedCount: 0,
          durationMs: derivationDuration,
        });
        this.emit({
          type: 'xpub.empty',
          parentAccountId: parentAccount.id,
          blockchain,
        });
        return ok({ sessions: [] });
      }

      childAccounts = [];
      for (const derived of derivedAddresses) {
        const normalizedResult = blockchainAdapter.normalizeAddress(derived.address);
        if (normalizedResult.isErr()) {
          logger.warn(`Skipping invalid derived address: ${derived.address}`);
          continue;
        }

        const existingChild = existingChildrenByIdentifier.get(normalizedResult.value);
        if (existingChild) {
          childAccounts.push(existingChild);
          continue;
        }

        const childResult = await this.ports.createAccount({
          profileId: parentAccount.profileId,
          parentAccountId: parentAccount.id,
          accountType: 'blockchain',
          platformKey: blockchain,
          identifier: normalizedResult.value,
          providerName,
        });
        if (childResult.isErr()) return err(childResult.error);

        existingChildrenByIdentifier.set(normalizedResult.value, childResult.value);
        childAccounts.push(childResult.value);
      }

      if (existingMetadata) {
        newlyDerivedCount = childAccounts.length - (existingMetadata.derivedCount ?? 0);
      } else if (hasExistingChildren) {
        newlyDerivedCount = childAccounts.length - existingChildren.length;
      }

      this.emit({
        type: 'xpub.derivation.completed',
        parentAccountId: parentAccount.id,
        derivedCount: childAccounts.length,
        newCount: existingMetadata || hasExistingChildren ? newlyDerivedCount : undefined,
        durationMs: derivationDuration,
      });

      const metadataResult = await this.ports.updateAccount(parentAccount.id, {
        metadata: {
          xpub: {
            gapLimit: requestedGap,
            lastDerivedAt: Date.now(),
            derivedCount: childAccounts.length,
          },
        },
      });
      if (metadataResult.isErr()) {
        logger.warn(
          { accountId: parentAccount.id, error: metadataResult.error },
          'Failed to persist xpub metadata; re-derivation may occur on next import'
        );
      }

      logger.info(
        `Derived ${childAccounts.length} addresses` + (newlyDerivedCount > 0 ? ` (${newlyDerivedCount} new)` : '')
      );
    } else {
      childAccounts = existingChildren;
      logger.info(`Reusing ${childAccounts.length} existing child accounts`);
    }

    this.emit({
      type: 'xpub.import.started',
      parentAccountId: parentAccount.id,
      childAccountCount: childAccounts.length,
      blockchain,
      parentIsNew: !parentAlreadyExists,
    });

    const importSessions: ImportSession[] = [];

    for (const childAccount of childAccounts) {
      if (this.abortController.signal.aborted) {
        return err(new Error('Import aborted'));
      }

      logger.info(`Importing child account #${childAccount.id}`);
      const importResult = await this.importFromSource(childAccount);

      if (importResult.isErr()) {
        this.emit({
          type: 'xpub.import.failed',
          parentAccountId: parentAccount.id,
          failedChildAccountId: childAccount.id,
          error: importResult.error.message,
        });
        return err(new Error(`Failed to import child account #${childAccount.id}: ${importResult.error.message}`));
      }

      importSessions.push(importResult.value);
    }

    const totalImported = importSessions.reduce((sum, s) => sum + s.transactionsImported, 0);
    const totalSkipped = importSessions.reduce((sum, s) => sum + s.transactionsSkipped, 0);

    this.emit({
      type: 'xpub.import.completed',
      parentAccountId: parentAccount.id,
      sessions: importSessions,
      totalImported,
      totalSkipped,
    });

    logger.info(`Completed xpub import: ${totalImported} transactions from ${importSessions.length} addresses`);

    return ok({ sessions: importSessions });
  }

  // ---------------------------------------------------------------------------
  // Streaming import (core loop)
  // ---------------------------------------------------------------------------

  private async importFromSource(account: Account): Promise<Result<ImportSession, Error>> {
    const buildResult = this.buildImporter(account);
    if (buildResult.isErr()) return err(buildResult.error);
    const { importer, params } = buildResult.value;
    return this.executeStreamingImport(account, importer, params);
  }

  private buildImporter(account: Account): Result<{ importer: IImporter; params: StreamingImportParams }, Error> {
    const platformKey = account.platformKey;
    const platformKind = account.accountType;

    logger.debug(`Setting up ${platformKind} import for ${platformKey}`);

    const params: StreamingImportParams = {
      platformKey,
      platformKind,
      cursor: account.lastCursor,
    };

    if (platformKind === 'blockchain') {
      params.address = account.identifier;
      params.providerName = account.providerName ?? undefined;
      if (!params.address) {
        return err(new Error(`Address required for ${platformKey} import`));
      }
    } else if (platformKind === 'exchange-api') {
      params.credentials = account.credentials ?? undefined;
    } else if (platformKind === 'exchange-csv') {
      params.csvDirectory = account.identifier;
    }

    const normalizedSourceName = platformKey.toLowerCase();

    if (platformKind === 'blockchain') {
      const adapterResult = this.registry.getBlockchain(normalizedSourceName);
      if (adapterResult.isErr()) return err(adapterResult.error);
      const importer = adapterResult.value.createImporter(this.providerRuntime, params.providerName);
      return ok({ importer, params });
    }

    const adapterResult = this.registry.getExchange(normalizedSourceName);
    if (adapterResult.isErr()) return err(adapterResult.error);
    const importer = adapterResult.value.createImporter();
    return ok({ importer, params });
  }

  private async executeStreamingImport(
    account: Account,
    importer: IImporter,
    params: StreamingImportParams
  ): Promise<Result<ImportSession, Error>> {
    const platformKey = account.platformKey;

    // Session create/resume (crash recovery)
    const incompleteResult = await this.ports.findLatestIncompleteImportSession(account.id);
    if (incompleteResult.isErr()) return err(incompleteResult.error);

    const incompleteSession = incompleteResult.value;
    let importSessionId: number;
    let totalImported = 0;
    let totalSkipped = 0;
    let totalFetchedRun = 0;

    if (incompleteSession) {
      importSessionId = incompleteSession.id;
      totalImported = incompleteSession.transactionsImported || 0;
      totalSkipped = incompleteSession.transactionsSkipped || 0;

      logger.info(
        `Resuming import from import session #${importSessionId} (total so far: ${totalImported} imported, ${totalSkipped} skipped)`
      );

      const updateResult = await this.ports.updateImportSession(importSessionId, { status: 'started' });
      if (updateResult.isErr()) return err(updateResult.error);
    } else {
      const createResult = await this.ports.createImportSession(account.id);
      if (createResult.isErr()) return err(createResult.error);
      importSessionId = createResult.value;
      logger.info(`Created new import session #${importSessionId}`);
    }

    const isNewAccount = account.lastCursor === undefined || Object.keys(account.lastCursor).length === 0;

    // Fetch transaction counts for existing accounts (event metadata)
    let transactionCounts: Map<string, number> | undefined;
    let transactionCountWarning: string | undefined;
    if (!isNewAccount) {
      const countsResult = await this.ports.countRawTransactionsByStreamType(account.id);
      if (countsResult.isOk()) {
        transactionCounts = countsResult.value;
      } else {
        transactionCountWarning = `Failed to fetch import stream counts for account ${account.id}: ${countsResult.error.message}`;
        logger.warn(
          { accountId: account.id, error: countsResult.error },
          'Failed to fetch import stream counts; continuing without transaction count metadata'
        );
      }
    }

    this.emit({
      type: 'import.started',
      platformKey,
      platformKind: account.accountType,
      accountId: account.id,
      parentAccountId: account.parentAccountId,
      isNewAccount,
      address: account.accountType === 'blockchain' ? account.identifier : undefined,
      transactionCounts,
    });

    if (transactionCountWarning) {
      this.emit({
        type: 'import.warning',
        platformKey,
        accountId: account.id,
        warning: transactionCountWarning,
      });
    }

    const startTime = Date.now();
    const allWarnings: string[] = [];

    try {
      const batchIterator = importer.importStreaming(params);

      for await (const batchResult of batchIterator) {
        if (this.abortController.signal.aborted) {
          await this.ports.updateImportSession(importSessionId, {
            status: 'failed',
            error_message: 'Import aborted by user',
            transactions_imported: totalImported,
            transactions_skipped: totalSkipped,
          });
          return err(new Error('Import aborted by user'));
        }

        if (batchResult.isErr()) {
          await this.ports.updateImportSession(importSessionId, {
            status: 'failed',
            error_message: batchResult.error.message,
            transactions_imported: totalImported,
            transactions_skipped: totalSkipped,
          });
          return err(batchResult.error);
        }

        const batch = batchResult.value;
        const fetchedInBatch = batch.providerStats?.fetched ?? batch.rawTransactions.length;
        const deduplicatedInBatch = batch.providerStats?.deduplicated ?? 0;

        if (batch.warnings && batch.warnings.length > 0) {
          allWarnings.push(...batch.warnings);
          for (const warning of batch.warnings) {
            logger.warn(`Import warning: ${warning}`);
            this.emit({
              type: 'import.warning',
              platformKey,
              accountId: account.id,
              streamType: batch.streamType,
              warning,
            });
          }
        }

        logger.debug(`Saving ${batch.rawTransactions.length} ${batch.streamType}...`);

        // Atomically: save raw transactions + update session totals + advance cursor
        const batchCommitResult = await this.ports.withTransaction(async (tx) => {
          const saveResult = await tx.createRawTransactionBatch(account.id, batch.rawTransactions);
          if (saveResult.isErr()) return err(saveResult.error);

          const { inserted, skipped } = saveResult.value;
          const newTotalImported = totalImported + inserted;
          const newTotalSkipped = totalSkipped + skipped;

          const sessionUpdateResult = await tx.updateImportSession(importSessionId, {
            transactions_imported: newTotalImported,
            transactions_skipped: newTotalSkipped,
          });
          if (sessionUpdateResult.isErr()) return err(sessionUpdateResult.error);

          const cursorUpdateResult = await tx.updateAccountCursor(account.id, batch.streamType, batch.cursor);
          if (cursorUpdateResult.isErr()) return err(cursorUpdateResult.error);

          return ok({ inserted, skipped });
        });

        if (batchCommitResult.isErr()) {
          await this.ports.updateImportSession(importSessionId, {
            status: 'failed',
            error_message: batchCommitResult.error.message,
            transactions_imported: totalImported,
            transactions_skipped: totalSkipped,
          });
          return err(batchCommitResult.error);
        }

        const { inserted, skipped } = batchCommitResult.value;
        totalImported += inserted;
        totalSkipped += skipped;
        totalFetchedRun += fetchedInBatch;

        if (skipped > 0) {
          logger.info(`Skipped ${skipped} duplicate transactions in batch`);
        }

        logger.info(
          `Batch saved: ${inserted} inserted, ${skipped} skipped of ${batch.rawTransactions.length} ${batch.streamType} (${fetchedInBatch} fetched, ${deduplicatedInBatch} deduplicated by provider, total fetched this run: ${totalFetchedRun})`
        );

        this.emit({
          type: 'import.batch',
          platformKey,
          accountId: account.id,
          fetched: fetchedInBatch,
          deduplicated: deduplicatedInBatch,
          batchInserted: inserted,
          batchSkipped: skipped,
          totalImported,
          totalSkipped,
          streamType: batch.streamType,
          cursorProgress: batch.cursor.totalFetched,
          totalFetchedRun,
          isComplete: batch.isComplete,
        });

        if (batch.isComplete) {
          logger.debug(`Import for ${batch.streamType} marked complete by provider`);
        }
      }

      // Handle warnings → failure
      if (allWarnings.length > 0) {
        const warningMessage = `Import completed with ${allWarnings.length} warning(s) and was marked as failed to prevent processing incomplete data. `;

        const finalizeResult = await this.ports.finalizeImportSession(importSessionId, {
          status: 'failed',
          startTime,
          imported: totalImported,
          skipped: totalSkipped,
          errorMessage: warningMessage,
          metadata: { warnings: allWarnings },
        });
        if (finalizeResult.isErr()) return err(finalizeResult.error);

        logger.warn(`Import marked failed due to ${allWarnings.length} warning(s). Data may be incomplete.`);

        this.emit({
          type: 'import.failed',
          platformKey,
          accountId: account.id,
          error: warningMessage,
        });

        return err(new Error(warningMessage));
      }

      // Success: finalize session + invalidate projections atomically
      if (totalImported > 0) {
        const finalizeResult = await this.ports.withTransaction(async (tx) => {
          const finalize = await tx.finalizeImportSession(importSessionId, {
            status: 'completed',
            startTime,
            imported: totalImported,
            skipped: totalSkipped,
          });
          if (finalize.isErr()) return err(finalize.error);

          const invalidate = await tx.invalidateProjections(
            [account.id],
            `import:${platformKey}:account-${account.id}`
          );
          if (invalidate.isErr()) return err(invalidate.error);

          return ok(undefined);
        });
        if (finalizeResult.isErr()) return err(finalizeResult.error);
      } else {
        const finalizeResult = await this.ports.finalizeImportSession(importSessionId, {
          status: 'completed',
          startTime,
          imported: totalImported,
          skipped: totalSkipped,
        });
        if (finalizeResult.isErr()) return err(finalizeResult.error);
      }

      if (account.accountType === 'exchange-csv') {
        logger.info(`Import completed for ${platformKey}: ${totalImported} items saved`);
      } else {
        logger.info(
          `Import completed for ${platformKey}: ${totalImported} items saved, ${totalSkipped} duplicates skipped`
        );
      }

      this.emit({
        type: 'import.completed',
        platformKey,
        accountId: account.id,
        totalImported,
        totalSkipped,
        durationMs: Date.now() - startTime,
      });

      const sessionResult = await this.ports.findImportSessionById(importSessionId);
      if (sessionResult.isErr()) return err(sessionResult.error);
      if (!sessionResult.value) {
        return err(new Error(`Import session #${importSessionId} not found after finalization`));
      }

      return ok(sessionResult.value);
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      await this.ports.finalizeImportSession(importSessionId, {
        status: 'failed',
        startTime,
        imported: totalImported,
        skipped: totalSkipped,
        errorMessage: originalError.message,
        metadata: error instanceof Error ? { stack: error.stack } : { error: String(error) },
      });

      logger.error(`Import failed for ${platformKey}: ${originalError.message}`);

      this.emit({
        type: 'import.failed',
        platformKey,
        accountId: account.id,
        error: originalError.message,
      });

      return err(originalError);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private emit(event: ImportEvent): void {
    this.eventBus?.emit(event);
  }
}
