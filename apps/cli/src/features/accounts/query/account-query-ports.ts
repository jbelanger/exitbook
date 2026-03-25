import type { Account, AccountType, BalanceSnapshot, ImportSession, ProjectionStatus, Profile } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

interface AccountFindAllFilters {
  accountType?: AccountType | undefined;
  parentAccountId?: number | undefined;
  platformKey?: string | undefined;
  profileId?: number | undefined;
}

export interface AccountQueryPorts {
  findOrCreateDefaultProfile(): Promise<Result<Profile, Error>>;
  findAccountById(id: number): Promise<Result<Account | undefined, Error>>;
  findAccounts(filters?: AccountFindAllFilters): Promise<Result<Account[], Error>>;
  countSessionsByAccount(accountIds: number[]): Promise<Result<Map<number, number>, Error>>;
  findSessions(filters?: { accountIds?: number[] }): Promise<Result<ImportSession[], Error>>;
  findBalanceSnapshots(scopeAccountIds: number[]): Promise<Result<Map<number, BalanceSnapshot>, Error>>;
  checkBalanceFreshness(
    scopeAccountId: number
  ): Promise<Result<{ reason?: string | undefined; status: ProjectionStatus }, Error>>;
}
