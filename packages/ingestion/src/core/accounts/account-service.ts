import type { Account } from '@exitbook/core';
import type { AccountRepository, IImportSessionRepository, UserRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { AccountQueryParams, AccountQueryResult, SessionSummary } from './account-service-utils.js';
import { formatAccount } from './account-service-utils.js';

const logger = getLogger('AccountService');

/**
 * Parameters for viewing accounts with optional session details
 */
export interface ViewAccountsParams extends AccountQueryParams {
  showSessions?: boolean;
}

/**
 * Account service - handles account querying and presentation logic.
 * Separates persistence orchestration from CLI handlers.
 */
export class AccountService {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly sessionRepo: IImportSessionRepository,
    private readonly userRepo: UserRepository
  ) {}

  /**
   * Query accounts with optional session details.
   * Handles user scoping, filtering, and aggregation.
   */
  async viewAccounts(params: ViewAccountsParams): Promise<Result<AccountQueryResult, Error>> {
    try {
      // Fetch accounts from repository
      const accountsResult = await this.fetchAccounts(params);

      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }

      const accounts = accountsResult.value;

      // Optionally fetch session counts and details
      let sessionCounts: Map<number, number> | undefined;
      let sessionDetails: Map<number, SessionSummary[]> | undefined;

      if (params.showSessions) {
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

      // Count total displayed accounts (parents + all nested children)
      const totalDisplayedCount = this.countDisplayedAccounts(formattedAccounts.value);

      const result: AccountQueryResult = {
        accounts: formattedAccounts.value,
        sessions: sessionDetails,
        count: totalDisplayedCount,
      };

      return ok(result);
    } catch (error) {
      logger.error({ error }, 'Failed to query accounts');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Fetch accounts based on filters.
   * Scopes to default user's accounts (not tracking-only accounts with userId=null).
   */
  private async fetchAccounts(params: AccountQueryParams): Promise<Result<Account[], Error>> {
    // Get the default user to scope queries
    const userResult = await this.userRepo.ensureDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    if (params.accountId) {
      const accountResult = await this.accountRepo.findById(params.accountId);
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

    // Scope to default user's accounts only (not tracking-only accounts with userId=null)
    return this.accountRepo.findAll({
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
    return this.sessionRepo.getSessionCountsByAccount(accountIds);
  }

  /**
   * Fetch session details for accounts in one query (avoids N+1).
   */
  private async fetchSessionsForAccounts(accounts: Account[]): Promise<Result<Map<number, SessionSummary[]>, Error>> {
    const accountIds = accounts.map((a) => a.id);

    // Fetch all sessions for all accounts in one query
    const sessionsResult = await this.sessionRepo.findByAccounts(accountIds);
    if (sessionsResult.isErr()) {
      return err(sessionsResult.error);
    }

    // Group sessions by accountId
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
   * For parent accounts (those with child accounts), includes child accounts and aggregates session counts.
   * Special case: When viewing a single child account by ID, include it directly.
   */
  private async formatAccountsWithHierarchy(
    accounts: Account[],
    sessionCounts: Map<number, number> | undefined
  ): Promise<Result<import('./account-service-utils.js').FormattedAccount[], Error>> {
    const formatted: import('./account-service-utils.js').FormattedAccount[] = [];

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
      const childAccountsResult = await this.accountRepo.findByParent(account.id);
      if (childAccountsResult.isErr()) {
        return err(childAccountsResult.error);
      }

      const childAccounts = childAccountsResult.value;

      // Format child accounts
      let formattedChildren: import('./account-service-utils.js').FormattedAccount[] | undefined;
      let totalSessionCount = sessionCounts?.get(account.id) ?? 0;

      if (childAccounts.length > 0) {
        formattedChildren = [];
        for (const child of childAccounts) {
          const childSessionCount = sessionCounts?.get(child.id) ?? 0;
          totalSessionCount += childSessionCount;

          formattedChildren.push(formatAccount(child, childSessionCount));
        }
      }

      // Format parent account with aggregated session count
      formatted.push(formatAccount(account, totalSessionCount, formattedChildren));
    }

    return ok(formatted);
  }

  /**
   * Count total displayed accounts including nested children.
   * This ensures the count matches what users see in the output.
   */
  private countDisplayedAccounts(accounts: import('./account-service-utils.js').FormattedAccount[]): number {
    let count = 0;
    for (const account of accounts) {
      count++; // Count the parent
      if (account.childAccounts) {
        count += this.countDisplayedAccounts(account.childAccounts); // Recursively count children
      }
    }
    return count;
  }
}
