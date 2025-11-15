import type { Account } from '@exitbook/core';
import type { AccountRepository, UserRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { IDataSourceRepository } from '../types/repositories.js';

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
    private readonly dataSourceRepo: IDataSourceRepository,
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

      // Build result
      const result: AccountQueryResult = {
        accounts: accounts.map((a) => formatAccount(a, sessionCounts?.get(a.id))),
        sessions: sessionDetails,
        count: accounts.length,
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
      return ok([accountResult.value]);
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
    return this.dataSourceRepo.getSessionCountsByAccount(accountIds);
  }

  /**
   * Fetch session details for accounts.
   */
  private async fetchSessionsForAccounts(accounts: Account[]): Promise<Result<Map<number, SessionSummary[]>, Error>> {
    const sessions = new Map<number, SessionSummary[]>();

    for (const account of accounts) {
      const sessionsResult = await this.dataSourceRepo.findByAccount(account.id);
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }

      const sessionSummaries: SessionSummary[] = sessionsResult.value.map((ds) => ({
        id: ds.id,
        status: ds.status,
        startedAt: ds.startedAt.toISOString(),
        completedAt: ds.completedAt?.toISOString(),
      }));

      sessions.set(account.id, sessionSummaries);
    }

    return ok(sessions);
  }
}
