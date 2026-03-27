import type { Account, AccountType, ExchangeCredentials, Profile } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

export interface IProfileLifecycleStore {
  create(input: { displayName: string; profileKey: string }): Promise<Result<Profile, Error>>;
  findByKey(profileKey: string): Promise<Result<Profile | undefined, Error>>;
  findOrCreateDefault(): Promise<Result<Profile, Error>>;
  list(): Promise<Result<Profile[], Error>>;
  updateDisplayName(profileKey: string, displayName: string): Promise<Result<Profile, Error>>;
}

export interface IAccountLifecycleStore {
  create(input: {
    accountType: AccountType;
    credentials?: ExchangeCredentials | undefined;
    identifier: string;
    metadata?: Account['metadata'] | undefined;
    name: string;
    platformKey: string;
    profileId: number;
    providerName?: string | undefined;
  }): Promise<Result<Account, Error>>;
  findById(accountId: number): Promise<Result<Account | undefined, Error>>;
  findByKey(input: {
    accountType: AccountType;
    identifier: string;
    platformKey: string;
    profileId: number;
  }): Promise<Result<Account | undefined, Error>>;
  findByName(profileId: number, name: string): Promise<Result<Account | undefined, Error>>;
  findChildren(parentAccountId: number, profileId: number): Promise<Result<Account[], Error>>;
  listTopLevel(profileId: number): Promise<Result<Account[], Error>>;
  update(
    accountId: number,
    updates: {
      credentials?: ExchangeCredentials | undefined;
      identifier?: string | undefined;
      metadata?: Account['metadata'] | undefined;
      name?: string | null | undefined;
      providerName?: string | undefined;
      resetCursor?: boolean | undefined;
    }
  ): Promise<Result<void, Error>>;
}
