import {
  type Account,
  type BalanceSnapshot,
  type IBalanceScopeAccountLookup,
  resolveBalanceScopeAccountId as resolveSharedBalanceScopeAccountId,
  wrapError,
} from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type {
  AccountListResult,
  AccountProjectionFreshness,
  AccountQueryParams,
  AccountSummary,
  SessionSummary,
} from './account-query-utils.js';
import { toAccountSummary } from './account-query-utils.js';
import type { AccountQueryPorts } from './ports/account-query-ports.js';

export type {
  AccountListResult,
  AccountBalanceProjectionStatus,
  AccountProjectionFreshness,
  AccountQueryParams,
  AccountSummary,
  AccountVerificationStatus,
  SessionSummary,
} from './account-query-utils.js';

const logger = getLogger('AccountQuery');

/**
 * Read model for account views.
 *
 * Builds account hierarchy (parent/child for xpub), attaches session summaries,
 * scopes to default user. Uses capability-owned ports for persistence access.
 */
export class AccountQuery {
  constructor(private readonly ports: AccountQueryPorts) {}

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

      const balanceSnapshotsResult = await this.fetchBalanceSnapshots(accounts);
      if (balanceSnapshotsResult.isErr()) {
        return err(balanceSnapshotsResult.error);
      }

      const scopeAccountIdsResult = await this.resolveScopeAccountIds(accounts);
      if (scopeAccountIdsResult.isErr()) {
        return err(scopeAccountIdsResult.error);
      }

      const balanceFreshnessResult = await this.fetchBalanceFreshness(
        scopeAccountIdsResult.value,
        balanceSnapshotsResult.value
      );
      if (balanceFreshnessResult.isErr()) {
        return err(balanceFreshnessResult.error);
      }

      const formattedAccounts = await this.formatAccountsWithHierarchy(
        accounts,
        sessionCounts,
        balanceSnapshotsResult.value,
        scopeAccountIdsResult.value,
        balanceFreshnessResult.value
      );
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
  async findById(id: number): Promise<Result<AccountSummary | undefined, Error>> {
    try {
      const userResult = await this.ports.users.findOrCreateDefault();
      if (userResult.isErr()) {
        return err(userResult.error);
      }
      const user = userResult.value;

      const accountResult = await this.ports.accounts.findById(id);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }
      const account = accountResult.value;
      if (!account) {
        return ok(undefined);
      }

      if (account.userId !== user.id) {
        return ok(undefined);
      }

      const countsResult = await this.ports.importSessions.countByAccount([id]);
      if (countsResult.isErr()) {
        return err(countsResult.error);
      }

      const sessionCount = countsResult.value.get(id) ?? 0;

      const childAccountsResult = await this.ports.accounts.findAll({ parentAccountId: id });
      if (childAccountsResult.isErr()) {
        return err(childAccountsResult.error);
      }

      const balanceSnapshotsResult = await this.fetchBalanceSnapshots([account, ...childAccountsResult.value]);
      if (balanceSnapshotsResult.isErr()) {
        return err(balanceSnapshotsResult.error);
      }

      const scopeAccountIdsResult = await this.resolveScopeAccountIds([account, ...childAccountsResult.value]);
      if (scopeAccountIdsResult.isErr()) {
        return err(scopeAccountIdsResult.error);
      }

      const balanceFreshnessResult = await this.fetchBalanceFreshness(
        scopeAccountIdsResult.value,
        balanceSnapshotsResult.value
      );
      if (balanceFreshnessResult.isErr()) {
        return err(balanceFreshnessResult.error);
      }

      let formattedChildren: AccountSummary[] | undefined;
      let totalSessionCount = sessionCount;

      if (childAccountsResult.value.length > 0) {
        const childIds = childAccountsResult.value.map((c) => c.id);
        const childCountsResult = await this.ports.importSessions.countByAccount(childIds);
        if (childCountsResult.isErr()) {
          return err(childCountsResult.error);
        }

        formattedChildren = [];
        for (const child of childAccountsResult.value) {
          const childSessionCount = childCountsResult.value.get(child.id) ?? 0;
          totalSessionCount += childSessionCount;
          formattedChildren.push(
            toAccountSummary(
              child,
              childSessionCount,
              balanceSnapshotsResult.value.get(scopeAccountIdsResult.value.get(child.id) ?? child.id),
              balanceFreshnessResult.value.get(scopeAccountIdsResult.value.get(child.id) ?? child.id)
            )
          );
        }
      }

      return ok(
        toAccountSummary(
          account,
          totalSessionCount,
          balanceSnapshotsResult.value.get(scopeAccountIdsResult.value.get(account.id) ?? account.id),
          balanceFreshnessResult.value.get(scopeAccountIdsResult.value.get(account.id) ?? account.id),
          formattedChildren
        )
      );
    } catch (error) {
      logger.error({ error }, 'Failed to find account');
      return wrapError(error, 'Failed to find account');
    }
  }

  private async fetchAccounts(params: AccountQueryParams): Promise<Result<Account[], Error>> {
    const userResult = await this.ports.users.findOrCreateDefault();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    if (params.accountId) {
      const accountResult = await this.ports.accounts.findById(params.accountId);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }
      const account = accountResult.value;
      if (!account) {
        return err(new Error(`Account ${params.accountId} not found`));
      }

      if (account.userId !== user.id) {
        return err(
          new Error(
            `Account ${params.accountId} does not belong to the default user (expected userId=${user.id}, found ${account.userId ?? 'null'})`
          )
        );
      }

      return ok([account]);
    }

    return this.ports.accounts.findAll({
      accountType: params.accountType,
      sourceName: params.source,
      userId: user.id,
    });
  }

  private async fetchSessionCounts(accounts: Account[]): Promise<Result<Map<number, number>, Error>> {
    const accountIds = accounts.map((a) => a.id);
    return this.ports.importSessions.countByAccount(accountIds);
  }

  private async fetchSessionsForAccounts(accounts: Account[]): Promise<Result<Map<number, SessionSummary[]>, Error>> {
    const accountIds = accounts.map((a) => a.id);

    const sessionsResult = await this.ports.importSessions.findAll({ accountIds });
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

  private async fetchBalanceSnapshots(accounts: Account[]): Promise<Result<Map<number, BalanceSnapshot>, Error>> {
    const scopeAccountIdsResult = await this.resolveScopeAccountIds(accounts);
    if (scopeAccountIdsResult.isErr()) {
      return err(scopeAccountIdsResult.error);
    }

    const scopeAccountIds = [...new Set(scopeAccountIdsResult.value.values())];
    return this.ports.balanceSnapshots.findSnapshots(scopeAccountIds);
  }

  private async fetchBalanceFreshness(
    scopeAccountIds: Map<number, number>,
    snapshots: Map<number, BalanceSnapshot>
  ): Promise<Result<Map<number, AccountProjectionFreshness>, Error>> {
    const freshnessByScopeId = new Map<number, AccountProjectionFreshness>();

    for (const scopeAccountId of new Set(scopeAccountIds.values())) {
      const snapshot = snapshots.get(scopeAccountId);
      if (!snapshot) {
        freshnessByScopeId.set(scopeAccountId, {
          status: 'never-built',
          reason: 'balance snapshot has never been built',
        });
        continue;
      }

      const freshnessResult = await this.ports.balanceFreshness.checkFreshness(scopeAccountId);
      if (freshnessResult.isErr()) {
        return err(freshnessResult.error);
      }

      freshnessByScopeId.set(scopeAccountId, {
        status: freshnessResult.value.status,
        reason: freshnessResult.value.reason,
      });
    }

    return ok(freshnessByScopeId);
  }

  private async formatAccountsWithHierarchy(
    accounts: Account[],
    sessionCounts: Map<number, number> | undefined,
    balanceSnapshots: Map<number, BalanceSnapshot>,
    scopeAccountIds: Map<number, number>,
    balanceFreshness: Map<number, AccountProjectionFreshness>
  ): Promise<Result<AccountSummary[], Error>> {
    const formatted: AccountSummary[] = [];

    for (const account of accounts) {
      if (account.parentAccountId && accounts.length === 1) {
        const sessionCount = sessionCounts?.get(account.id) ?? 0;
        const scopeAccountId = scopeAccountIds.get(account.id) ?? account.id;
        formatted.push(
          toAccountSummary(
            account,
            sessionCount,
            balanceSnapshots.get(scopeAccountId),
            balanceFreshness.get(scopeAccountId)
          )
        );
        continue;
      }

      if (account.parentAccountId) {
        continue;
      }

      const childAccountsResult = await this.ports.accounts.findAll({ parentAccountId: account.id });
      if (childAccountsResult.isErr()) {
        return err(childAccountsResult.error);
      }

      const childAccounts = childAccountsResult.value;

      let formattedChildren: AccountSummary[] | undefined;
      let totalSessionCount = sessionCounts?.get(account.id) ?? 0;

      if (childAccounts.length > 0) {
        formattedChildren = [];
        for (const child of childAccounts) {
          const childSessionCount = sessionCounts?.get(child.id) ?? 0;
          const childScopeAccountId = scopeAccountIds.get(child.id) ?? child.id;
          totalSessionCount += childSessionCount;
          formattedChildren.push(
            toAccountSummary(
              child,
              childSessionCount,
              balanceSnapshots.get(childScopeAccountId),
              balanceFreshness.get(childScopeAccountId)
            )
          );
        }
      }

      const scopeAccountId = scopeAccountIds.get(account.id) ?? account.id;
      formatted.push(
        toAccountSummary(
          account,
          totalSessionCount,
          balanceSnapshots.get(scopeAccountId),
          balanceFreshness.get(scopeAccountId),
          formattedChildren
        )
      );
    }

    return ok(formatted);
  }

  private async resolveScopeAccountIds(accounts: Account[]): Promise<Result<Map<number, number>, Error>> {
    const scopeAccountIds = new Map<number, number>();
    const scopeAccountLookup: IBalanceScopeAccountLookup<Account> = {
      findById: async (accountId: number) => {
        return this.ports.accounts.findById(accountId);
      },
    };

    for (const account of accounts) {
      const scopeAccountIdResult = await resolveSharedBalanceScopeAccountId(account, scopeAccountLookup, {
        cache: scopeAccountIds,
      });
      if (scopeAccountIdResult.isErr()) {
        return err(scopeAccountIdResult.error);
      }

      scopeAccountIds.set(account.id, scopeAccountIdResult.value);
    }

    return ok(scopeAccountIds);
  }

  private countDisplayedAccounts(accounts: AccountSummary[]): number {
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
