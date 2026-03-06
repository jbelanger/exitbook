import { type Account, wrapError } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';

import type { AccountListResult, AccountQueryParams, AccountView, SessionSummary } from './account-query-utils.js';
import { formatAccount } from './account-query-utils.js';

export type { AccountListResult, AccountQueryParams, AccountView, SessionSummary } from './account-query-utils.js';

const logger = getLogger('AccountQuery');

/**
 * Read model for account views.
 *
 * Builds account hierarchy (parent/child for xpub), attaches session summaries,
 * scopes to default user. Uses DataContext directly — pure app-layer query.
 */
export class AccountQuery {
  constructor(private readonly db: DataContext) {}

  /**
   * List accounts with optional session details.
   * Handles user scoping, filtering, hierarchy, and aggregation.
   */
  async list(params?: AccountQueryParams): Promise<Result<AccountListResult, Error>> {
    try {
      const resolvedParams = params ?? {};

      const accountsResult = await this.fetchAccounts(resolvedParams);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }

      const accounts = accountsResult.value;

      // Optionally fetch session counts and details
      let sessionCounts: Map<number, number> | undefined;
      let sessionDetails: Map<number, SessionSummary[]> | undefined;

      if (resolvedParams.showSessions) {
        const sessionsResult = await this.fetchSessionsForAccounts(accounts);
        if (sessionsResult.isErr()) {
          return err(sessionsResult.error);
        }
        sessionDetails = sessionsResult.value;
        sessionCounts = new Map(
          Array.from(sessionDetails.entries()).map(([accountId, sessions]) => [accountId, sessions.length])
        );
      } else {
        const countsResult = await this.fetchSessionCounts(accounts);
        if (countsResult.isErr()) {
          return err(countsResult.error);
        }
        sessionCounts = countsResult.value;
      }

      // Build result with parent/child hierarchy
      const formattedAccounts = await this.formatAccountsWithHierarchy(accounts, sessionCounts);
      if (formattedAccounts.isErr()) {
        return err(formattedAccounts.error);
      }

      const totalDisplayedCount = this.countDisplayedAccounts(formattedAccounts.value);

      return ok({
        accounts: formattedAccounts.value,
        sessions: sessionDetails,
        count: totalDisplayedCount,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to query accounts');
      return wrapError(error, 'Failed to query accounts');
    }
  }

  /**
   * Find a single account by ID.
   * Scopes to default user.
   */
  async findById(id: number): Promise<Result<AccountView | undefined, Error>> {
    try {
      const userResult = await this.db.users.findOrCreateDefault();
      if (userResult.isErr()) {
        return err(userResult.error);
      }
      const user = userResult.value;

      const accountResult = await this.db.accounts.findById(id);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }
      const account = accountResult.value;

      // Enforce tenancy
      if (account.userId !== user.id) {
        return ok(undefined);
      }

      // Fetch session count
      const countsResult = await this.db.importSessions.countByAccount([id]);
      if (countsResult.isErr()) {
        return err(countsResult.error);
      }

      const sessionCount = countsResult.value.get(id) ?? 0;

      // Fetch children
      const childAccountsResult = await this.db.accounts.findAll({ parentAccountId: id });
      if (childAccountsResult.isErr()) {
        return err(childAccountsResult.error);
      }

      let formattedChildren: AccountView[] | undefined;
      let totalSessionCount = sessionCount;

      if (childAccountsResult.value.length > 0) {
        const childIds = childAccountsResult.value.map((c) => c.id);
        const childCountsResult = await this.db.importSessions.countByAccount(childIds);
        if (childCountsResult.isErr()) {
          return err(childCountsResult.error);
        }

        formattedChildren = [];
        for (const child of childAccountsResult.value) {
          const childSessionCount = childCountsResult.value.get(child.id) ?? 0;
          totalSessionCount += childSessionCount;
          formattedChildren.push(formatAccount(child, childSessionCount));
        }
      }

      return ok(formatAccount(account, totalSessionCount, formattedChildren));
    } catch (error) {
      logger.error({ error }, 'Failed to find account');
      return wrapError(error, 'Failed to find account');
    }
  }

  /**
   * Fetch accounts based on filters.
   * Scopes to default user's accounts (not tracking-only accounts with userId=null).
   */
  private async fetchAccounts(params: AccountQueryParams): Promise<Result<Account[], Error>> {
    const userResult = await this.db.users.findOrCreateDefault();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    if (params.accountId) {
      const accountResult = await this.db.accounts.findById(params.accountId);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }
      const account = accountResult.value;

      // Enforce tenancy: only return accounts owned by the default user
      if (account.userId !== user.id) {
        return err(
          new Error(
            `Account ${params.accountId} does not belong to the default user (expected userId=${user.id}, found ${account.userId ?? 'null'})`
          )
        );
      }

      return ok([account]);
    }

    // Scope to default user's accounts only
    return this.db.accounts.findAll({
      accountType: params.accountType,
      sourceName: params.source,
      userId: user.id,
    });
  }

  /**
   * Fetch session counts for accounts (aggregated query to avoid N+1).
   */
  private async fetchSessionCounts(accounts: Account[]): Promise<Result<Map<number, number>, Error>> {
    const accountIds = accounts.map((a) => a.id);
    return this.db.importSessions.countByAccount(accountIds);
  }

  /**
   * Fetch session details for accounts in one query (avoids N+1).
   */
  private async fetchSessionsForAccounts(accounts: Account[]): Promise<Result<Map<number, SessionSummary[]>, Error>> {
    const accountIds = accounts.map((a) => a.id);

    const sessionsResult = await this.db.importSessions.findAll({ accountIds });
    if (sessionsResult.isErr()) {
      return err(sessionsResult.error);
    }

    const sessions = new Map<number, SessionSummary[]>();

    for (const ds of sessionsResult.value) {
      const summary: SessionSummary = {
        id: ds.id,
        status: ds.status,
        startedAt: ds.startedAt.toISOString(),
        completedAt: ds.completedAt?.toISOString(),
      };

      const existing = sessions.get(ds.accountId);
      if (existing) {
        existing.push(summary);
      } else {
        sessions.set(ds.accountId, [summary]);
      }
    }

    return ok(sessions);
  }

  /**
   * Format accounts with parent/child hierarchy.
   * For parent accounts, includes child accounts and aggregates session counts.
   * Special case: When viewing a single child account by ID, include it directly.
   */
  private async formatAccountsWithHierarchy(
    accounts: Account[],
    sessionCounts: Map<number, number> | undefined
  ): Promise<Result<AccountView[], Error>> {
    const formatted: AccountView[] = [];

    for (const account of accounts) {
      // Special case: If user requested a specific child account by ID, include it directly
      if (account.parentAccountId && accounts.length === 1) {
        const sessionCount = sessionCounts?.get(account.id) ?? 0;
        formatted.push(formatAccount(account, sessionCount));
        continue;
      }

      // Skip child accounts - they'll be included under their parents
      if (account.parentAccountId) {
        continue;
      }

      // Check if this account has children
      const childAccountsResult = await this.db.accounts.findAll({ parentAccountId: account.id });
      if (childAccountsResult.isErr()) {
        return err(childAccountsResult.error);
      }

      const childAccounts = childAccountsResult.value;

      // Format child accounts
      let formattedChildren: AccountView[] | undefined;
      let totalSessionCount = sessionCounts?.get(account.id) ?? 0;

      if (childAccounts.length > 0) {
        formattedChildren = [];
        for (const child of childAccounts) {
          const childSessionCount = sessionCounts?.get(child.id) ?? 0;
          totalSessionCount += childSessionCount;
          formattedChildren.push(formatAccount(child, childSessionCount));
        }
      }

      formatted.push(formatAccount(account, totalSessionCount, formattedChildren));
    }

    return ok(formatted);
  }

  /**
   * Count total displayed accounts including nested children.
   */
  private countDisplayedAccounts(accounts: AccountView[]): number {
    let count = 0;
    for (const account of accounts) {
      count++;
      if (account.childAccounts) {
        count += this.countDisplayedAccounts(account.childAccounts);
      }
    }
    return count;
  }
}
