import type { Account, AccountType, ExchangeCredentials } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { IAccountLifecycleStore } from '../ports/index.js';

const logger = getLogger('account-lifecycle-service');

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

export interface CreateNamedAccountResult {
  account: Account;
  disposition: 'adopted' | 'created';
}

function normalizeAccountName(name: string): Result<string, Error> {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return err(new Error('Account name must not be empty'));
  }

  return ok(normalized);
}

export class AccountLifecycleService {
  constructor(private readonly store: IAccountLifecycleStore) {}

  async createNamed(input: CreateNamedAccountInput): Promise<Result<CreateNamedAccountResult, Error>> {
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

      const adoptResult = await this.store.update(existingByKey.id, {
        name: normalizedName,
        providerName: input.providerName,
        credentials: input.credentials,
        metadata: input.metadata,
      });
      if (adoptResult.isErr()) {
        return err(adoptResult.error);
      }

      logger.info(
        { accountId: existingByKey.id, name: normalizedName },
        'Adopted unnamed legacy account into named lifecycle'
      );
      const adoptedAccountResult = await this.getByName(input.profileId, normalizedName);
      if (adoptedAccountResult.isErr()) {
        return err(adoptedAccountResult.error);
      }
      if (!adoptedAccountResult.value) {
        return err(new Error(`Account '${normalizedName}' disappeared after adoption`));
      }

      return ok({
        account: adoptedAccountResult.value,
        disposition: 'adopted',
      });
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

    return ok({
      account: createResult.value,
      disposition: 'created',
    });
  }

  listTopLevel(
    profileId: number,
    options?: { includeUnnamed?: boolean | undefined }
  ): Promise<Result<Account[], Error>> {
    return this.store.listTopLevel(profileId, options);
  }

  getById(accountId: number): Promise<Result<Account | undefined, Error>> {
    return this.store.findById(accountId);
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

    const refreshedResult = await this.store.findById(accountResult.value.id);
    if (refreshedResult.isErr()) {
      return err(refreshedResult.error);
    }
    if (!refreshedResult.value) {
      return err(new Error(`Account ${accountResult.value.id} disappeared after rename`));
    }

    return ok(refreshedResult.value);
  }

  async collectHierarchy(rootAccountId: number): Promise<Result<Account[], Error>> {
    const rootResult = await this.store.findById(rootAccountId);
    if (rootResult.isErr()) {
      return err(rootResult.error);
    }
    if (!rootResult.value) {
      return err(new Error(`Account ${rootAccountId} not found`));
    }

    const ordered: Account[] = [rootResult.value];
    const queue: number[] = [rootAccountId];

    while (queue.length > 0) {
      const parentId = queue.shift()!;
      const childrenResult = await this.store.findChildren(parentId);
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
}
