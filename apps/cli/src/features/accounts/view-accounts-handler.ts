import type { Account } from '@exitbook/core';
import type { AccountRepository, UserRepository } from '@exitbook/data';
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
    private readonly dataSourceRepo: DataSourceRepository,
    private readonly userRepo: UserRepository
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

  /**
   * Format account for display.
   */
  private formatAccount(account: Account, sessionCount: number | undefined): ViewAccountsResult['accounts'][number] {
    return {
      id: account.id,
      accountType: account.accountType,
      sourceName: account.sourceName,
      identifier: this.maskIdentifier(account),
      providerName: account.providerName ?? undefined,
      lastBalanceCheckAt: account.lastBalanceCheckAt?.toISOString(),
      verificationStatus: this.getVerificationStatus(account),
      sessionCount,
      createdAt: account.createdAt.toISOString(),
    };
  }

  /**
   * Mask sensitive identifiers (API keys) for security.
   * Shows first 8 chars + *** for exchange-api accounts, full address for blockchain.
   */
  private maskIdentifier(account: Account): string {
    if (account.accountType === 'exchange-api' && account.identifier) {
      // Mask API keys: show first 8 chars + ***
      const key = account.identifier;
      if (key.length <= 8) {
        return '***';
      }
      return `${key.slice(0, 8)}***`;
    }
    // For blockchain and exchange-csv, show the full identifier
    return account.identifier;
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
