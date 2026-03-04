import type { Account } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { EventSink } from '../pipeline/pipeline-context.js';

import type { ClearParams, ClearResult, DeletionPreview, ResolvedAccount } from './clear-operation-utils.js';
import {
  calculateTotalDeletionItems,
  describeFilters,
  extractAccountIds,
  resolveAccountsForClear,
  validateClearParams,
} from './clear-operation-utils.js';

export type { ClearParams, ClearResult, DeletionPreview } from './clear-operation-utils.js';

const logger = getLogger('ClearOperation');

/**
 * Data deletion and reset.
 *
 * Owns: deletion preview, FK-ordered deletion, user-scoped guards,
 * partial clear (reprocess) vs full clear (delete accounts + raw data).
 *
 * Uses DataContext directly — pure app-layer policy, not domain logic.
 */
export class ClearOperation {
  constructor(
    private readonly db: DataContext,
    private readonly events?: EventSink | undefined
  ) {}

  async preview(params: ClearParams): Promise<Result<DeletionPreview, Error>> {
    try {
      const validation = validateClearParams(params);
      if (validation.isErr()) {
        return wrapError(validation.error, 'Failed to validate clear parameters');
      }

      const accountsResult = await this.resolveAccounts(params);
      if (accountsResult.isErr())
        return wrapError(accountsResult.error, 'Failed to resolve accounts for clear operation');
      const accountsToClear = accountsResult.value;

      const filtersProvided = params.accountId !== undefined || params.source !== undefined;
      if (filtersProvided && accountsToClear.length === 0) {
        return wrapError(
          `No accounts matched the provided filters (${describeFilters(params)}). No data deleted.`,
          'Failed to preview clear operation'
        );
      }

      return this.countForDeletion(accountsToClear, params.includeRaw);
    } catch (error) {
      return wrapError(error, 'Failed to preview clear operation');
    }
  }

  async execute(params: ClearParams): Promise<Result<ClearResult, Error>> {
    const startTime = Date.now();
    try {
      const validation = validateClearParams(params);
      if (validation.isErr()) {
        return wrapError(validation.error, 'Failed to validate clear parameters');
      }

      logger.debug(
        { includeRaw: params.includeRaw, source: params.source, accountId: params.accountId },
        'Starting data clearing'
      );

      const previewResult = await this.preview(params);
      if (previewResult.isErr()) return wrapError(previewResult.error, 'Failed to preview clear operation');
      const preview = previewResult.value;

      if (calculateTotalDeletionItems(preview) === 0) {
        return ok({ deleted: preview });
      }

      this.events?.emit({
        type: 'clear.started',
        accountId: params.accountId,
        includeRaw: params.includeRaw,
        preview,
      });

      const accountsResult = await this.resolveAccounts(params);
      if (accountsResult.isErr())
        return wrapError(accountsResult.error, 'Failed to resolve accounts for clear operation');
      const accountsToClear = accountsResult.value;

      const filtersProvided = params.accountId !== undefined || params.source !== undefined;
      if (filtersProvided && accountsToClear.length === 0) {
        return wrapError(
          `No accounts matched the provided filters (${describeFilters(params)}). No data deleted.`,
          'Failed to execute clear operation'
        );
      }

      const deleteResult =
        accountsToClear.length > 0
          ? await this.deleteForAccounts(accountsToClear, params.includeRaw)
          : await this.deleteAll(params.includeRaw);
      if (deleteResult.isErr()) return wrapError(deleteResult.error, 'Failed to delete data');

      logger.debug({ deleted: preview }, 'Data clearing completed');

      this.events?.emit({
        type: 'clear.completed',
        deleted: preview,
        durationMs: Date.now() - startTime,
      });

      return ok({ deleted: preview });
    } catch (error) {
      return wrapError(error, 'Failed to execute clear operation');
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async countForDeletion(
    accountsToClear: ResolvedAccount[],
    includeRaw: boolean
  ): Promise<Result<DeletionPreview, Error>> {
    if (accountsToClear.length > 0) {
      return this.countForAccounts(extractAccountIds(accountsToClear), includeRaw);
    }
    return this.countAll(includeRaw);
  }

  private async countForAccounts(accountIds: number[], includeRaw: boolean): Promise<Result<DeletionPreview, Error>> {
    let sessionsCount = 0;
    let rawDataCount = 0;
    let accountsCount = 0;

    if (includeRaw) {
      const sessionsResult = await this.db.importSessions.count({ accountIds });
      if (sessionsResult.isErr()) return err(sessionsResult.error);
      sessionsCount = sessionsResult.value;

      const rawDataResult = await this.db.rawTransactions.count({ accountIds });
      if (rawDataResult.isErr()) return err(rawDataResult.error);
      rawDataCount = rawDataResult.value;

      accountsCount = accountIds.length;
    }

    const transactionsResult = await this.db.transactions.count({ accountIds, includeExcluded: true });
    if (transactionsResult.isErr()) return err(transactionsResult.error);

    const linksResult = await this.db.transactionLinks.count({ accountIds });
    if (linksResult.isErr()) return err(linksResult.error);

    return ok({
      accounts: accountsCount,
      links: linksResult.value,
      rawData: rawDataCount,
      sessions: sessionsCount,
      transactions: transactionsResult.value,
    });
  }

  private async countAll(includeRaw: boolean): Promise<Result<DeletionPreview, Error>> {
    let sessionsCount = 0;
    let rawDataCount = 0;

    if (includeRaw) {
      const sessionsResult = await this.db.importSessions.count();
      if (sessionsResult.isErr()) return err(sessionsResult.error);
      sessionsCount = sessionsResult.value;

      const rawDataResult = await this.db.rawTransactions.count();
      if (rawDataResult.isErr()) return err(rawDataResult.error);
      rawDataCount = rawDataResult.value;
    }

    const transactionsResult = await this.db.transactions.count({ includeExcluded: true });
    if (transactionsResult.isErr()) return err(transactionsResult.error);

    const linksResult = await this.db.transactionLinks.count();
    if (linksResult.isErr()) return err(linksResult.error);

    return ok({
      accounts: 0,
      links: linksResult.value,
      rawData: rawDataCount,
      sessions: sessionsCount,
      transactions: transactionsResult.value,
    });
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

    return this.db.executeInTransaction(async (tx) => {
      const consolidatedResult = await tx.utxoConsolidatedMovements.deleteByAccountIds(accountIds);
      if (consolidatedResult.isErr()) return err(consolidatedResult.error);

      const linksResult = await tx.transactionLinks.deleteByAccountIds(accountIds);
      if (linksResult.isErr()) return err(linksResult.error);

      const transactionsResult = await tx.transactions.deleteByAccountIds(accountIds);
      if (transactionsResult.isErr()) return err(transactionsResult.error);

      for (const { account } of accountsToClear) {
        if (includeRaw) {
          const rawResult = await tx.rawTransactions.deleteAll({ accountId: account.id });
          if (rawResult.isErr()) return err(rawResult.error);

          const sessionResult = await tx.importSessions.deleteBy({ accountId: account.id });
          if (sessionResult.isErr()) return err(sessionResult.error);
        } else {
          const resetResult = await tx.rawTransactions.resetProcessingStatus({ accountId: account.id });
          if (resetResult.isErr()) return err(resetResult.error);
        }
      }

      if (includeRaw) {
        const deleteAccountsResult = await tx.accounts.deleteByIds(accountIds);
        if (deleteAccountsResult.isErr()) return err(deleteAccountsResult.error);
      }

      return ok(undefined);
    });
  }

  /**
   * Delete all data.
   * All operations run inside a single DB transaction — partial failure rolls back atomically.
   */
  private async deleteAll(includeRaw: boolean): Promise<Result<void, Error>> {
    return this.db.executeInTransaction(async (tx) => {
      const consolidatedResult = await tx.utxoConsolidatedMovements.deleteAll();
      if (consolidatedResult.isErr()) return err(consolidatedResult.error);

      const linksResult = await tx.transactionLinks.deleteAll();
      if (linksResult.isErr()) return err(linksResult.error);

      const transactionsResult = await tx.transactions.deleteAll();
      if (transactionsResult.isErr()) return err(transactionsResult.error);

      if (includeRaw) {
        const rawResult = await tx.rawTransactions.deleteAll();
        if (rawResult.isErr()) return err(rawResult.error);

        const sessionResult = await tx.importSessions.deleteBy();
        if (sessionResult.isErr()) return err(sessionResult.error);
      } else {
        const resetResult = await tx.rawTransactions.resetProcessingStatus();
        if (resetResult.isErr()) return err(resetResult.error);
      }

      return ok(undefined);
    });
  }

  /**
   * Resolve accounts to clear based on params.
   * Scoped to default user to prevent accidental cross-user data deletion.
   */
  private async resolveAccounts(params: ClearParams): Promise<Result<ResolvedAccount[], Error>> {
    const userResult = await this.db.users.findOrCreateDefault();
    if (userResult.isErr()) return err(userResult.error);
    const user = userResult.value;

    let accountById: Account | undefined;
    let accountsBySource: Account[] = [];

    if (params.accountId) {
      const result = await this.db.accounts.findAll({ userId: user.id });
      if (result.isErr()) return err(result.error);
      accountById = result.value.find((acc) => acc.id === params.accountId);
      if (!accountById) {
        return err(new Error(`Account ${params.accountId} not found for user ${user.id}`));
      }
    }

    if (params.source) {
      const result = await this.db.accounts.findAll({ userId: user.id, sourceName: params.source });
      if (result.isErr()) return err(result.error);
      accountsBySource = result.value;
    }

    return ok(resolveAccountsForClear(params, accountById, accountsBySource));
  }
}
