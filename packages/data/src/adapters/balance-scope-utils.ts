import type { Account } from '@exitbook/core';
import {
  err,
  ok,
  resolveBalanceScopeAccountId as resolveSharedBalanceScopeAccountId,
  type Result,
} from '@exitbook/core';

import type { DataContext } from '../data-context.js';

export function toBalanceScopeKey(scopeAccountId: number): string {
  return `balance:${scopeAccountId}`;
}

export async function resolveBalanceScopeAccountId(db: DataContext, accountId: number): Promise<Result<number, Error>> {
  const requestedAccountResult = await loadRequestedAccount(db, accountId);
  if (requestedAccountResult.isErr()) {
    return err(requestedAccountResult.error);
  }

  return resolveSharedBalanceScopeAccountId(requestedAccountResult.value, {
    findById: async (id: number) => db.accounts.findByIdOptional(id),
  });
}

export async function resolveBalanceScopeAccountIds(
  db: DataContext,
  accountIds?: number[]
): Promise<Result<number[] | undefined, Error>> {
  if (!accountIds) {
    return ok(undefined);
  }

  const scopeIds = new Set<number>();
  const scopeCache = new Map<number, number>();

  for (const accountId of accountIds) {
    const requestedAccountResult = await loadRequestedAccount(db, accountId);
    if (requestedAccountResult.isErr()) {
      return err(requestedAccountResult.error);
    }

    const scopeAccountIdResult = await resolveSharedBalanceScopeAccountId(
      requestedAccountResult.value,
      {
        findById: async (id: number) => db.accounts.findByIdOptional(id),
      },
      { cache: scopeCache }
    );
    if (scopeAccountIdResult.isErr()) {
      return err(scopeAccountIdResult.error);
    }

    scopeIds.add(scopeAccountIdResult.value);
  }

  return ok([...scopeIds]);
}

async function loadRequestedAccount(db: DataContext, accountId: number): Promise<Result<Account, Error>> {
  const accountResult = await db.accounts.findById(accountId);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }

  if (!accountResult.value) {
    return err(new Error(`Account ${accountId} not found while resolving balance scope for ${accountId}`));
  }

  return ok(accountResult.value);
}
