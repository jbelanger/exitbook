import { type Account, wrapError } from '@exitbook/core';
import {
  createAccountQueries,
  createImportSessionQueries,
  createRawDataQueries,
  createTransactionLinkQueries,
  createTransactionQueries,
  createUserQueries,
  type KyselyDB,
  withControlledTransaction,
} from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IngestionEvent } from '../../events.js';

import type { ClearServiceParams, DeletionPreview, ResolvedAccount } from './clear-service-utils.js';
import {
  calculateTotalDeletionItems,
  extractAccountIds,
  resolveAccountsForClear,
  validateClearParams,
} from './clear-service-utils.js';

const logger = getLogger('ClearService');

/**
 * Result of the clear operation
 */
export interface ClearResult {
  deleted: DeletionPreview;
}

/**
 * Clear service - handles data deletion operations.
 * Imperative shell that orchestrates repositories and pure functions.
 */
export class ClearService {
  private readonly userQueries: ReturnType<typeof createUserQueries>;
  private readonly accountQueries: ReturnType<typeof createAccountQueries>;
  private readonly transactionQueries: ReturnType<typeof createTransactionQueries>;
  private readonly transactionLinkQueries: ReturnType<typeof createTransactionLinkQueries>;
  private readonly rawDataQueries: ReturnType<typeof createRawDataQueries>;
  private readonly sessionQueries: ReturnType<typeof createImportSessionQueries>;

  constructor(
    private db: KyselyDB,
    private eventBus?: EventBus<IngestionEvent> | undefined
  ) {
    this.userQueries = createUserQueries(db);
    this.accountQueries = createAccountQueries(db);
    this.transactionQueries = createTransactionQueries(db);
    this.transactionLinkQueries = createTransactionLinkQueries(db);
    this.rawDataQueries = createRawDataQueries(db);
    this.sessionQueries = createImportSessionQueries(db);
  }

  /**
   * Preview what will be deleted.
   */
  async previewDeletion(params: ClearServiceParams): Promise<Result<DeletionPreview, Error>> {
    try {
      // Validate params
      const validation = validateClearParams(params);
      if (!validation.valid) {
        return err(new Error(validation.error));
      }

      // Resolve accounts (imperative - fetches from DB)
      const accountsResult = await this.resolveAccounts(params);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }
      const accountsToClear = accountsResult.value;

      // If filters were provided but matched no accounts, return error to prevent accidental deletion
      const filtersProvided = params.accountId !== undefined || params.source !== undefined;
      if (filtersProvided && accountsToClear.length === 0) {
        return err(
          new Error(
            `No accounts matched the provided filters (${params.accountId ? `accountId=${params.accountId}` : ''}${params.accountId && params.source ? ', ' : ''}${params.source ? `source=${params.source}` : ''}). No data deleted.`
          )
        );
      }

      // Count what will be deleted
      if (accountsToClear.length > 0) {
        // Account-scoped deletion
        const accountIds = extractAccountIds(accountsToClear);

        // Only count sessions, rawData, and accounts if includeRaw is true (otherwise they won't be deleted)
        let sessionsCount = 0;
        let rawDataCount = 0;
        let accountsCount = 0;

        if (params.includeRaw) {
          const sessionsResult = await this.sessionQueries.count({ accountIds });
          if (sessionsResult.isErr()) {
            return err(sessionsResult.error);
          }
          sessionsCount = sessionsResult.value;

          const rawDataResult = await this.rawDataQueries.count({ accountIds });
          if (rawDataResult.isErr()) {
            return err(rawDataResult.error);
          }
          rawDataCount = rawDataResult.value;

          accountsCount = accountsToClear.length;
        }

        const transactionsResult = await this.transactionQueries.countTransactions({
          accountIds,
          includeExcluded: true,
        });
        if (transactionsResult.isErr()) {
          return err(transactionsResult.error);
        }

        const linksResult = await this.transactionLinkQueries.count({ accountIds });
        if (linksResult.isErr()) {
          return err(linksResult.error);
        }

        return ok({
          accounts: accountsCount,
          links: linksResult.value,
          rawData: rawDataCount,
          sessions: sessionsCount,
          transactions: transactionsResult.value,
        });
      } else {
        // Delete all - use repository count methods
        // Only count sessions and rawData if includeRaw is true (otherwise they won't be deleted)
        let sessionsCount = 0;
        let rawDataCount = 0;

        if (params.includeRaw) {
          const sessionsResult = await this.sessionQueries.count();
          if (sessionsResult.isErr()) {
            return err(sessionsResult.error);
          }
          sessionsCount = sessionsResult.value;

          const rawDataResult = await this.rawDataQueries.count();
          if (rawDataResult.isErr()) {
            return err(rawDataResult.error);
          }
          rawDataCount = rawDataResult.value;
        }

        const transactionsResult = await this.transactionQueries.countTransactions({ includeExcluded: true });
        if (transactionsResult.isErr()) {
          return err(transactionsResult.error);
        }

        const linksResult = await this.transactionLinkQueries.count();
        if (linksResult.isErr()) {
          return err(linksResult.error);
        }

        // For delete-all, we don't delete accounts (they remain for future imports)
        return ok({
          accounts: 0,
          links: linksResult.value,
          rawData: rawDataCount,
          sessions: sessionsCount,
          transactions: transactionsResult.value,
        });
      }
    } catch (error) {
      return wrapError(error, 'Failed to preview clear operation');
    }
  }

  /**
   * Execute the clear operation.
   */
  async execute(params: ClearServiceParams): Promise<Result<ClearResult, Error>> {
    const startTime = Date.now();
    try {
      // Validate params
      const validation = validateClearParams(params);
      if (!validation.valid) {
        return err(new Error(validation.error));
      }

      logger.debug(
        { includeRaw: params.includeRaw, source: params.source, accountId: params.accountId },
        'Starting data clearing'
      );

      const preview = await this.previewDeletion(params);
      if (preview.isErr()) {
        return err(preview.error);
      }

      // Check if there's anything to delete (pure function)
      const totalItems = calculateTotalDeletionItems(preview.value);
      if (totalItems === 0) {
        return ok({ deleted: preview.value });
      }

      // Emit clear.started event
      this.eventBus?.emit({
        type: 'clear.started',
        accountId: params.accountId,
        includeRaw: params.includeRaw,
        preview: preview.value,
      });

      // Resolve accounts to clear
      const accountsResult = await this.resolveAccounts(params);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }
      const accountsToClear = accountsResult.value;

      // If filters were provided but matched no accounts, return error to prevent accidental deletion
      const filtersProvided = params.accountId !== undefined || params.source !== undefined;
      if (filtersProvided && accountsToClear.length === 0) {
        return err(
          new Error(
            `No accounts matched the provided filters (${params.accountId ? `accountId=${params.accountId}` : ''}${params.accountId && params.source ? ', ' : ''}${params.source ? `source=${params.source}` : ''}). No data deleted.`
          )
        );
      }

      // Delete in correct order (respecting FK constraints)
      if (accountsToClear.length > 0) {
        const deleteResult = await this.deleteForAccounts(accountsToClear, params.includeRaw);
        if (deleteResult.isErr()) {
          return err(deleteResult.error);
        }
      } else {
        // Only delete all if no filters were provided (explicit delete-all request)
        const deleteResult = await this.deleteAll(params.includeRaw);
        if (deleteResult.isErr()) {
          return err(deleteResult.error);
        }
      }

      logger.debug({ deleted: preview.value }, 'Data clearing completed');

      // Emit clear.completed event
      this.eventBus?.emit({
        type: 'clear.completed',
        deleted: preview.value,
        durationMs: Date.now() - startTime,
      });

      return ok({ deleted: preview.value });
    } catch (error) {
      return wrapError(error, 'Failed to execute clear operation');
    }
  }

  /**
   * Delete data for specific accounts.
   * All operations run inside a single DB transaction — partial failure rolls back atomically.
   */
  private async deleteForAccounts(
    accountsToClear: ResolvedAccount[],
    includeRaw: boolean
  ): Promise<Result<void, Error>> {
    const accountIds = extractAccountIds(accountsToClear);

    return withControlledTransaction(
      this.db,
      logger,
      async (trx) => {
        const transactionLinkQueries = createTransactionLinkQueries(trx);
        const transactionQueries = createTransactionQueries(trx);
        const rawDataQueries = createRawDataQueries(trx);
        const sessionQueries = createImportSessionQueries(trx);
        const accountQueries = createAccountQueries(trx);

        // Delete transaction data by account_id
        const linksResult = await transactionLinkQueries.deleteByAccountIds(accountIds);
        if (linksResult.isErr()) return err(linksResult.error);

        const transactionsResult = await transactionQueries.deleteByAccountIds(accountIds);
        if (transactionsResult.isErr()) return err(transactionsResult.error);

        // Delete raw data and sessions (by account_id)
        for (const { account } of accountsToClear) {
          if (includeRaw) {
            const rawDataResult = await rawDataQueries.deleteByAccount(account.id);
            if (rawDataResult.isErr()) return err(rawDataResult.error);

            const importSessionResult = await sessionQueries.deleteByAccount(account.id);
            if (importSessionResult.isErr()) return err(importSessionResult.error);
          } else {
            // Reset raw data processing_status to 'pending' for reprocessing
            const resetResult = await rawDataQueries.resetProcessingStatusByAccount(account.id);
            if (resetResult.isErr()) return err(resetResult.error);
          }
        }

        // Only delete accounts if we're doing a full clear (includeRaw: true)
        // When includeRaw: false, we're just resetting for reprocessing, so keep the accounts
        if (includeRaw) {
          const deleteAccountsResult = await accountQueries.deleteByIds(accountIds);
          if (deleteAccountsResult.isErr()) return err(deleteAccountsResult.error);
        }

        return ok();
      },
      'Failed to delete account data'
    );
  }

  /**
   * Delete all data.
   * All operations run inside a single DB transaction — partial failure rolls back atomically.
   */
  private async deleteAll(includeRaw: boolean): Promise<Result<void, Error>> {
    return withControlledTransaction(
      this.db,
      logger,
      async (trx) => {
        const transactionLinkQueries = createTransactionLinkQueries(trx);
        const transactionQueries = createTransactionQueries(trx);
        const rawDataQueries = createRawDataQueries(trx);
        const sessionQueries = createImportSessionQueries(trx);

        const linksResult = await transactionLinkQueries.deleteAll();
        if (linksResult.isErr()) return err(linksResult.error);

        const transactionsResult = await transactionQueries.deleteAll();
        if (transactionsResult.isErr()) return err(transactionsResult.error);

        if (includeRaw) {
          const rawDataResult = await rawDataQueries.deleteAll();
          if (rawDataResult.isErr()) return err(rawDataResult.error);

          const importSessionResult = await sessionQueries.deleteAll();
          if (importSessionResult.isErr()) return err(importSessionResult.error);
        } else {
          // Reset raw data processing_status to 'pending' for reprocessing
          const resetResult = await rawDataQueries.resetProcessingStatusAll();
          if (resetResult.isErr()) return err(resetResult.error);
        }

        return ok();
      },
      'Failed to delete all data'
    );
  }

  /**
   * Resolve accounts to clear based on params.
   * Imperative - fetches from repositories.
   * Scoped to default user to prevent accidental cross-user data deletion.
   */
  private async resolveAccounts(params: ClearServiceParams): Promise<Result<ResolvedAccount[], Error>> {
    // 1. Ensure default user exists (id=1)
    const userResult = await this.userQueries.getOrCreateDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    let accountById;
    let accountsBySource: Account[] = [];

    // 2. Find accounts scoped to this user
    if (params.accountId) {
      // Use findAll with userId filter to ensure user scoping
      const result = await this.accountQueries.findAll({ userId: user.id });
      if (result.isErr()) {
        return err(result.error);
      }
      // Find the specific account by ID within this user's accounts
      accountById = result.value.find((acc) => acc.id === params.accountId);
      if (!accountById) {
        return err(new Error(`Account ${params.accountId} not found for user ${user.id}`));
      }
    }

    if (params.source) {
      // Use findAll with userId and sourceName filters
      const result = await this.accountQueries.findAll({
        userId: user.id,
        sourceName: params.source,
      });
      if (result.isErr()) {
        return err(result.error);
      }
      accountsBySource = result.value;
    }

    // 3. Use pure function to determine accounts
    const resolved = resolveAccountsForClear(params, accountById, accountsBySource);
    return ok(resolved);
  }
}
