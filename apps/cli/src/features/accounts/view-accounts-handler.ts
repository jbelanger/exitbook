import type { Account } from '@exitbook/core';
import type { AccountRepository } from '@exitbook/data';
import type { DataSourceRepository } from '@exitbook/ingestion';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { SessionSummary, ViewAccountsParams, ViewAccountsResult } from './view-accounts-utils.js';

/**
 * Handler for viewing accounts.
 */
export class ViewAccountsHandler {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly dataSourceRepo: DataSourceRepository
  ) {}

  /**
   * Execute the view accounts command.
   */
  async execute(params: ViewAccountsParams): Promise<Result<ViewAccountsResult, Error>> {
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
    const result: ViewAccountsResult = {
      accounts: accounts.map((a) => this.formatAccount(a, sessionCounts?.get(a.id))),
      sessions: sessionDetails,
      count: accounts.length,
    };

    return ok(result);
  }

  destroy(): void {
    // No cleanup needed
  }

  /**
   * Fetch accounts based on filters.
   */
  private async fetchAccounts(params: ViewAccountsParams): Promise<Result<Account[], Error>> {
    if (params.accountId) {
      const accountResult = await this.accountRepo.findById(params.accountId);
      if (accountResult.isErr()) {
        return err(accountResult.error);
      }
      return ok([accountResult.value]);
    }

    return this.accountRepo.findAll({
      accountType: params.accountType,
      sourceName: params.source,
      userId: undefined,
    });
  }

  /**
   * Fetch session counts for accounts.
   */
  private async fetchSessionCounts(accounts: Account[]): Promise<Result<Map<number, number>, Error>> {
    const counts = new Map<number, number>();

    for (const account of accounts) {
      const sessionsResult = await this.dataSourceRepo.findByAccount(account.id);
      if (sessionsResult.isErr()) {
        return err(sessionsResult.error);
      }
      counts.set(account.id, sessionsResult.value.length);
    }

    return ok(counts);
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

  /**
   * Format account for display.
   */
  private formatAccount(account: Account, sessionCount: number | undefined): ViewAccountsResult['accounts'][number] {
    return {
      id: account.id,
      accountType: account.accountType,
      sourceName: account.sourceName,
      identifier: account.identifier,
      providerName: account.providerName ?? undefined,
      lastBalanceCheckAt: account.lastBalanceCheckAt?.toISOString(),
      verificationStatus: this.getVerificationStatus(account),
      sessionCount,
      createdAt: account.createdAt.toISOString(),
    };
  }

  /**
   * Determine verification status from account metadata.
   */
  private getVerificationStatus(account: Account): 'match' | 'mismatch' | 'never-checked' | undefined {
    if (!account.verificationMetadata) {
      return account.lastBalanceCheckAt ? undefined : 'never-checked';
    }

    const metadata = account.verificationMetadata;
    const status = metadata.last_verification.status;

    if (status === 'match') {
      return 'match';
    }

    if (status === 'mismatch') {
      return 'mismatch';
    }

    return undefined;
  }
}
