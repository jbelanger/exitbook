import type { Account, AccountType, ImportSession, Result, User } from '@exitbook/core';

export interface AccountFindAllFilters {
  accountType?: AccountType | undefined;
  parentAccountId?: number | undefined;
  sourceName?: string | undefined;
  userId?: number | undefined;
}

export interface IAccountQueryUserLookup {
  findOrCreateDefault(): Promise<Result<User, Error>>;
}

export interface IAccountQueryAccountReader {
  findById(id: number): Promise<Result<Account, Error>>;
  findAll(filters?: AccountFindAllFilters): Promise<Result<Account[], Error>>;
}

export interface IAccountQuerySessionReader {
  countByAccount(accountIds: number[]): Promise<Result<Map<number, number>, Error>>;
  findAll(filters?: { accountIds?: number[] }): Promise<Result<ImportSession[], Error>>;
}

export interface AccountQueryPorts {
  users: IAccountQueryUserLookup;
  accounts: IAccountQueryAccountReader;
  importSessions: IAccountQuerySessionReader;
}
