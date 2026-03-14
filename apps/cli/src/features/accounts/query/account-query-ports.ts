import type {
  Account,
  AccountType,
  BalanceSnapshot,
  ImportSession,
  ProjectionStatus,
  Result,
  User,
} from '@exitbook/core';

interface AccountFindAllFilters {
  accountType?: AccountType | undefined;
  parentAccountId?: number | undefined;
  sourceName?: string | undefined;
  userId?: number | undefined;
}

export interface IAccountQueryUserLookup {
  findOrCreateDefault(): Promise<Result<User, Error>>;
}

export interface IAccountQueryAccountReader {
  findById(id: number): Promise<Result<Account | undefined, Error>>;
  findAll(filters?: AccountFindAllFilters): Promise<Result<Account[], Error>>;
}

export interface IAccountQuerySessionReader {
  countByAccount(accountIds: number[]): Promise<Result<Map<number, number>, Error>>;
  findAll(filters?: { accountIds?: number[] }): Promise<Result<ImportSession[], Error>>;
}

export interface IAccountQueryBalanceSnapshotReader {
  findSnapshots(scopeAccountIds: number[]): Promise<Result<Map<number, BalanceSnapshot>, Error>>;
}

export interface IAccountQueryBalanceFreshnessReader {
  checkFreshness(
    scopeAccountId: number
  ): Promise<Result<{ reason?: string | undefined; status: ProjectionStatus }, Error>>;
}

export interface AccountQueryPorts {
  users: IAccountQueryUserLookup;
  accounts: IAccountQueryAccountReader;
  importSessions: IAccountQuerySessionReader;
  balanceSnapshots: IAccountQueryBalanceSnapshotReader;
  balanceFreshness: IAccountQueryBalanceFreshnessReader;
}
