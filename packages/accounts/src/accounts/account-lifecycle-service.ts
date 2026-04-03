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
  findByFingerprintRef(profileId: number, fingerprintRef: string): Promise<Result<Account | undefined, Error>>;
  findByIdentity(input: {
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

export interface CreateAccountInput {
  profileId: number;
  name: string;
  accountType: AccountType;
  platformKey: string;
  identifier: string;
  providerName?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
  metadata?: Account['metadata'] | undefined;
}

export interface UpdateAccountInput {
  name?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
  identifier?: string | undefined;
  metadata?: Account['metadata'] | undefined;
  providerName?: string | undefined;
  resetCursor?: boolean | undefined;
}

const RESERVED_ACCOUNT_NAMES = new Set(['add', 'list', 'refresh', 'remove', 'update', 'view']);

function normalizeAccountName(name: string): Result<string, Error> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err(new Error('Account name must not be empty'));
  }

  if (RESERVED_ACCOUNT_NAMES.has(normalized)) {
    return err(
      new Error(
        `Account name '${normalized}' is reserved by the accounts command surface. Reserved names: ${[...RESERVED_ACCOUNT_NAMES].join(', ')}`
      )
    );
  }

  return ok(normalized);
}

function hasAccountPropertyChanges(input: UpdateAccountInput): boolean {
  return (
    input.name !== undefined ||
    input.identifier !== undefined ||
    input.providerName !== undefined ||
    input.credentials !== undefined ||
    input.metadata !== undefined
  );
}

function buildCreateIdentityConflictError(existingAccount: Account): Error {
  if (existingAccount.parentAccountId !== undefined) {
    return new Error(
      `Account config is already tracked by child account #${existingAccount.id}. Remove the parent wallet first if you want a standalone account.`
    );
  }

  if (existingAccount.name) {
    return new Error(
      `Account config already exists as '${existingAccount.name}'. Use that account name or update it first.`
    );
  }

  return new Error(
    `Account config already exists as top-level account #${existingAccount.id}. Clear and recreate that profile data before adding it again.`
  );
}

function buildUpdateIdentityConflictError(existingAccount: Account): Error {
  if (existingAccount.parentAccountId !== undefined) {
    return new Error(
      `Account config is already tracked by child account #${existingAccount.id}. Remove the parent wallet first or change the config.`
    );
  }

  if (existingAccount.name) {
    return new Error(
      `Account config already exists as '${existingAccount.name}'. Use that account name or change the config.`
    );
  }

  return new Error(
    `Account config is already tracked by top-level account #${existingAccount.id}. Clear and recreate that profile data before reusing this config.`
  );
}

export class AccountLifecycleService {
  constructor(private readonly store: AccountLifecycleStore) {}

  async create(input: CreateAccountInput): Promise<Result<Account, Error>> {
    const normalizedName = this.normalizeAccountName(input.name);
    if (normalizedName.isErr()) {
      return err(normalizedName.error);
    }

    const nameAvailabilityResult = await this.ensureAccountNameAvailable(input.profileId, normalizedName.value);
    if (nameAvailabilityResult.isErr()) {
      return err(nameAvailabilityResult.error);
    }

    const existingByIdentityResult = await this.findAccountByIdentity({
      accountType: input.accountType,
      identifier: input.identifier,
      platformKey: input.platformKey,
      profileId: input.profileId,
    });
    if (existingByIdentityResult.isErr()) {
      return err(existingByIdentityResult.error);
    }

    const existingByIdentity = existingByIdentityResult.value;
    if (existingByIdentity) {
      return err(buildCreateIdentityConflictError(existingByIdentity));
    }

    const createResult = await this.store.create({
      profileId: input.profileId,
      name: normalizedName.value,
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

  getByFingerprintRef(profileId: number, fingerprintRef: string): Promise<Result<Account | undefined, Error>> {
    return this.store.findByFingerprintRef(profileId, fingerprintRef);
  }

  async requireOwned(profileId: number, accountId: number): Promise<Result<Account, Error>> {
    const accountResult = await this.requireStoredAccount(accountId, `Account ${accountId} not found`);
    if (accountResult.isErr()) {
      return err(accountResult.error);
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

  async updateOwned(profileId: number, accountId: number, input: UpdateAccountInput): Promise<Result<Account, Error>> {
    if (!hasAccountPropertyChanges(input)) {
      return err(new Error('No account property changes were provided'));
    }

    const accountResult = await this.requireOwned(profileId, accountId);
    if (accountResult.isErr()) {
      return err(accountResult.error);
    }

    const account = accountResult.value;
    const updates: UpdateAccountInput = {
      ...(input.credentials !== undefined ? { credentials: input.credentials } : {}),
      ...(input.identifier !== undefined ? { identifier: input.identifier } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.providerName !== undefined ? { providerName: input.providerName } : {}),
      ...(input.resetCursor !== undefined ? { resetCursor: input.resetCursor } : {}),
    };

    if (input.name !== undefined) {
      const nextNameResult = this.normalizeAccountName(input.name);
      if (nextNameResult.isErr()) {
        return err(nextNameResult.error);
      }

      if (nextNameResult.value !== account.name) {
        const nameAvailabilityResult = await this.ensureAccountNameAvailable(
          profileId,
          nextNameResult.value,
          account.id
        );
        if (nameAvailabilityResult.isErr()) {
          return err(nameAvailabilityResult.error);
        }

        updates.name = nextNameResult.value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return err(new Error('No account property changes were provided'));
    }

    const nextIdentifier = input.identifier ?? account.identifier;
    if (nextIdentifier !== account.identifier) {
      const duplicateResult = await this.findAccountByIdentity({
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
        return err(buildUpdateIdentityConflictError(duplicate));
      }
    }

    const updateResult = await this.store.update(account.id, updates);
    if (updateResult.isErr()) {
      return err(updateResult.error);
    }

    return this.reloadAccount(account.id);
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

  private normalizeAccountName(name: string): Result<string, Error> {
    return normalizeAccountName(name);
  }

  private async ensureAccountNameAvailable(
    profileId: number,
    normalizedName: string,
    excludeAccountId?: number
  ): Promise<Result<void, Error>> {
    const existingByNameResult = await this.store.findByName(profileId, normalizedName);
    if (existingByNameResult.isErr()) {
      return err(existingByNameResult.error);
    }
    if (existingByNameResult.value && existingByNameResult.value.id !== excludeAccountId) {
      return err(new Error(`Account '${normalizedName}' already exists`));
    }

    return ok(undefined);
  }

  private async findAccountByIdentity(input: {
    accountType: AccountType;
    identifier: string;
    platformKey: string;
    profileId: number;
  }): Promise<Result<Account | undefined, Error>> {
    return this.store.findByIdentity(input);
  }

  private async requireStoredAccount(accountId: number, missingMessage: string): Promise<Result<Account, Error>> {
    const refreshedResult = await this.store.findById(accountId);
    if (refreshedResult.isErr()) {
      return err(refreshedResult.error);
    }
    if (!refreshedResult.value) {
      return err(new Error(missingMessage));
    }

    return ok(refreshedResult.value);
  }

  private async reloadAccount(accountId: number): Promise<Result<Account, Error>> {
    return this.requireStoredAccount(accountId, `Account ${accountId} disappeared after update`);
  }
}
