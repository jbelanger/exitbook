import type { Account, AccountType, ExchangeCredentials } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

interface AccountLifecycleStore {
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

export interface CreateNamedAccountInput {
  profileId: number;
  name: string;
  accountType: AccountType;
  platformKey: string;
  identifier: string;
  providerName?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
  metadata?: Account['metadata'] | undefined;
}

export interface UpdateNamedAccountInput {
  credentials?: ExchangeCredentials | undefined;
  identifier?: string | undefined;
  metadata?: Account['metadata'] | undefined;
  providerName?: string | undefined;
  resetCursor?: boolean | undefined;
}

function normalizeAccountName(name: string): Result<string, Error> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err(new Error('Account name must not be empty'));
  }

  return ok(normalized);
}

export class AccountLifecycleService {
  constructor(private readonly store: AccountLifecycleStore) {}

  async createNamed(input: CreateNamedAccountInput): Promise<Result<Account, Error>> {
    const normalizedNameResult = normalizeAccountName(input.name);
    if (normalizedNameResult.isErr()) {
      return err(normalizedNameResult.error);
    }
    const normalizedName = normalizedNameResult.value;

    const existingByNameResult = await this.store.findByName(input.profileId, normalizedName);
    if (existingByNameResult.isErr()) {
      return err(existingByNameResult.error);
    }
    if (existingByNameResult.value) {
      return err(new Error(`Account '${normalizedName}' already exists`));
    }

    const existingByKeyResult = await this.store.findByKey({
      accountType: input.accountType,
      identifier: input.identifier,
      platformKey: input.platformKey,
      profileId: input.profileId,
    });
    if (existingByKeyResult.isErr()) {
      return err(existingByKeyResult.error);
    }

    const existingByKey = existingByKeyResult.value;
    if (existingByKey) {
      if (existingByKey.parentAccountId !== undefined) {
        return err(
          new Error(
            `Account config is already tracked by child account #${existingByKey.id}. Remove the parent wallet first if you want a standalone account.`
          )
        );
      }

      if (existingByKey.name) {
        return err(
          new Error(
            `Account config already exists as '${existingByKey.name}'. Use that account name or rename it first.`
          )
        );
      }

      return err(
        new Error(
          `Account config already exists as unnamed account #${existingByKey.id}. Clear and recreate that profile data before adding it again.`
        )
      );
    }

    const createResult = await this.store.create({
      profileId: input.profileId,
      name: normalizedName,
      accountType: input.accountType,
      platformKey: input.platformKey,
      identifier: input.identifier,
      providerName: input.providerName,
      credentials: input.credentials,
      metadata: input.metadata,
    });
    if (createResult.isErr()) {
      return err(createResult.error);
    }

    return ok(createResult.value);
  }

  listTopLevel(profileId: number): Promise<Result<Account[], Error>> {
    return this.store.listTopLevel(profileId);
  }

  findById(accountId: number): Promise<Result<Account | undefined, Error>> {
    return this.store.findById(accountId);
  }

  async requireOwned(profileId: number, accountId: number): Promise<Result<Account, Error>> {
    const accountResult = await this.store.findById(accountId);
    if (accountResult.isErr()) {
      return err(accountResult.error);
    }
    if (!accountResult.value) {
      return err(new Error(`Account ${accountId} not found`));
    }
    if (accountResult.value.profileId !== profileId) {
      return err(new Error(`Account ${accountId} does not belong to the selected profile`));
    }

    return ok(accountResult.value);
  }

  getByName(profileId: number, name: string): Promise<Result<Account | undefined, Error>> {
    const normalizedNameResult = normalizeAccountName(name);
    if (normalizedNameResult.isErr()) {
      return Promise.resolve(err(normalizedNameResult.error));
    }

    return this.store.findByName(profileId, normalizedNameResult.value);
  }

  async rename(profileId: number, currentName: string, nextName: string): Promise<Result<Account, Error>> {
    const currentNameResult = normalizeAccountName(currentName);
    if (currentNameResult.isErr()) {
      return err(currentNameResult.error);
    }
    const nextNameResult = normalizeAccountName(nextName);
    if (nextNameResult.isErr()) {
      return err(nextNameResult.error);
    }

    const accountResult = await this.store.findByName(profileId, currentNameResult.value);
    if (accountResult.isErr()) {
      return err(accountResult.error);
    }
    if (!accountResult.value) {
      return err(new Error(`Account '${currentNameResult.value}' not found`));
    }

    const duplicateResult = await this.store.findByName(profileId, nextNameResult.value);
    if (duplicateResult.isErr()) {
      return err(duplicateResult.error);
    }
    if (duplicateResult.value && duplicateResult.value.id !== accountResult.value.id) {
      return err(new Error(`Account '${nextNameResult.value}' already exists`));
    }

    const updateResult = await this.store.update(accountResult.value.id, { name: nextNameResult.value });
    if (updateResult.isErr()) {
      return err(updateResult.error);
    }

    return this.requireAccount(accountResult.value.id);
  }

  async updateNamed(profileId: number, name: string, input: UpdateNamedAccountInput): Promise<Result<Account, Error>> {
    if (
      input.identifier === undefined &&
      input.providerName === undefined &&
      input.credentials === undefined &&
      input.metadata === undefined
    ) {
      return err(new Error('No account config changes were provided'));
    }

    const accountResult = await this.getByName(profileId, name);
    if (accountResult.isErr()) {
      return err(accountResult.error);
    }
    if (!accountResult.value) {
      return err(new Error(`Account '${name.trim().toLowerCase()}' not found`));
    }

    const account = accountResult.value;
    const nextIdentifier = input.identifier ?? account.identifier;
    if (nextIdentifier !== account.identifier) {
      const duplicateResult = await this.store.findByKey({
        accountType: account.accountType,
        identifier: nextIdentifier,
        platformKey: account.platformKey,
        profileId,
      });
      if (duplicateResult.isErr()) {
        return err(duplicateResult.error);
      }

      const duplicate = duplicateResult.value;
      if (duplicate && duplicate.id !== account.id) {
        if (duplicate.name) {
          return err(
            new Error(
              `Account config already exists as '${duplicate.name}'. Use that account name or change the config.`
            )
          );
        }

        return err(
          new Error(
            `Account config is already tracked by unnamed account #${duplicate.id}. Clear and recreate that profile data before reusing this config.`
          )
        );
      }
    }

    const updateResult = await this.store.update(account.id, input);
    if (updateResult.isErr()) {
      return err(updateResult.error);
    }

    return this.requireAccount(account.id);
  }

  async collectHierarchy(profileId: number, rootAccountId: number): Promise<Result<Account[], Error>> {
    const rootResult = await this.requireOwned(profileId, rootAccountId);
    if (rootResult.isErr()) {
      return err(rootResult.error);
    }

    const ordered: Account[] = [rootResult.value];
    const queue: number[] = [rootAccountId];

    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const childrenResult = await this.store.findChildren(parentId, profileId);
      if (childrenResult.isErr()) {
        return err(childrenResult.error);
      }

      for (const child of childrenResult.value) {
        ordered.push(child);
        queue.push(child.id);
      }
    }

    return ok(ordered);
  }

  private async requireAccount(accountId: number): Promise<Result<Account, Error>> {
    const refreshedResult = await this.store.findById(accountId);
    if (refreshedResult.isErr()) {
      return err(refreshedResult.error);
    }
    if (!refreshedResult.value) {
      return err(new Error(`Account ${accountId} disappeared after update`));
    }

    return ok(refreshedResult.value);
  }
}
