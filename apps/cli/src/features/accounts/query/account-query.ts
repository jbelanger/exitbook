import type { Account, BalanceSnapshot } from '@exitbook/core';
import { err, ok, type Result, wrapError } from '@exitbook/foundation';
import { resolveBalanceScopeAccountId } from '@exitbook/ingestion/ports';
import { getLogger } from '@exitbook/logger';

import type { AccountQueryPorts } from './account-query-ports.js';
import type {
  AccountListResult,
  AccountProjectionFreshness,
  AccountQueryParams,
  AccountSummary,
  SessionSummary,
} from './account-query-utils.js';
import { toAccountSummary } from './account-query-utils.js';

export type {
  AccountBalanceProjectionStatus,
  AccountQueryParams,
  AccountSummary,
  AccountVerificationStatus,
  SessionSummary,
} from './account-query-utils.js';

const logger = getLogger('AccountQuery');

export class AccountQuery {
  constructor(private readonly ports: AccountQueryPorts) {}

  async list(params: AccountQueryParams): Promise<Result<AccountListResult, Error>> {
    try {
      const resolvedParams = params;

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

      return ok({
        accounts: formattedAccounts.value,
        sessions: sessionDetails,
        count: this.countDisplayedAccounts(formattedAccounts.value),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to query accounts');
      return wrapError(error, 'Failed to query accounts');
    }
  }

  async findById(id: number, profileId: number): Promise<Result<AccountSummary | undefined, Error>> {
    try {
      const accountResult = await this.ports.findAccountById(id);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }
      const account = accountResult.value;
      if (!account) {
        return ok(undefined);
      }

      if (account.profileId !== profileId) {
        return ok(undefined);
      }

      const countsResult = await this.ports.countSessionsByAccount([id]);
      if (countsResult.isErr()) {
        return err(countsResult.error);
      }

      const sessionCount = countsResult.value.get(id) ?? 0;

      const childAccountsResult = await this.ports.findAccounts({ parentAccountId: id });
      if (childAccountsResult.isErr()) {
        return err(childAccountsResult.error);
      }

      const scopedAccounts = [account, ...childAccountsResult.value];
      const balanceSnapshotsResult = await this.fetchBalanceSnapshots(scopedAccounts);
      if (balanceSnapshotsResult.isErr()) {
        return err(balanceSnapshotsResult.error);
      }

      const scopeAccountIdsResult = await this.resolveScopeAccountIds(scopedAccounts);
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
        const childIds = childAccountsResult.value.map((childAccount) => childAccount.id);
        const childCountsResult = await this.ports.countSessionsByAccount(childIds);
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
    if (params.accountId) {
      const accountResult = await this.ports.findAccountById(params.accountId);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }

      const account = accountResult.value;
      if (!account) {
        return err(new Error(`Account ${params.accountId} not found`));
      }

      if (account.profileId !== params.profileId) {
        return err(
          new Error(
            `Account ${params.accountId} does not belong to profile ${params.profileId} (found ${account.profileId ?? 'null'})`
          )
        );
      }

      return ok([account]);
    }

    return this.ports.findAccounts({
      accountType: params.accountType,
      platformKey: params.source,
      profileId: params.profileId,
    });
  }

  private fetchSessionCounts(accounts: Account[]): Promise<Result<Map<number, number>, Error>> {
    return this.ports.countSessionsByAccount(accounts.map((account) => account.id));
  }

  private async fetchSessionsForAccounts(accounts: Account[]): Promise<Result<Map<number, SessionSummary[]>, Error>> {
    const sessionsResult = await this.ports.findSessions({
      accountIds: accounts.map((account) => account.id),
    });
    if (sessionsResult.isErr()) {
      return err(sessionsResult.error);
    }

    const sessions = new Map<number, SessionSummary[]>();
    for (const session of sessionsResult.value) {
      const summary: SessionSummary = {
        id: session.id,
        status: session.status,
        startedAt: session.startedAt.toISOString(),
        completedAt: session.completedAt?.toISOString(),
      };

      const existing = sessions.get(session.accountId);
      if (existing) {
        existing.push(summary);
      } else {
        sessions.set(session.accountId, [summary]);
      }
    }

    return ok(sessions);
  }

  private async fetchBalanceSnapshots(accounts: Account[]): Promise<Result<Map<number, BalanceSnapshot>, Error>> {
    const scopeAccountIdsResult = await this.resolveScopeAccountIds(accounts);
    if (scopeAccountIdsResult.isErr()) {
      return err(scopeAccountIdsResult.error);
    }

    return this.ports.findBalanceSnapshots([...new Set(scopeAccountIdsResult.value.values())]);
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

      const freshnessResult = await this.ports.checkBalanceFreshness(scopeAccountId);
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
        const scopeAccountId = scopeAccountIds.get(account.id) ?? account.id;
        formatted.push(
          toAccountSummary(
            account,
            sessionCounts?.get(account.id) ?? 0,
            balanceSnapshots.get(scopeAccountId),
            balanceFreshness.get(scopeAccountId)
          )
        );
        continue;
      }

      if (account.parentAccountId) {
        continue;
      }

      const childAccountsResult = await this.ports.findAccounts({ parentAccountId: account.id });
      if (childAccountsResult.isErr()) {
        return err(childAccountsResult.error);
      }

      let formattedChildren: AccountSummary[] | undefined;
      let totalSessionCount = sessionCounts?.get(account.id) ?? 0;

      if (childAccountsResult.value.length > 0) {
        formattedChildren = [];
        for (const child of childAccountsResult.value) {
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

    for (const account of accounts) {
      const scopeAccountIdResult = await resolveBalanceScopeAccountId(
        account,
        {
          findById: (accountId: number) => this.ports.findAccountById(accountId),
        },
        { cache: scopeAccountIds }
      );
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
      count += 1;
      if (account.childAccounts) {
        count += this.countDisplayedAccounts(account.childAccounts);
      }
    }
    return count;
  }
}
