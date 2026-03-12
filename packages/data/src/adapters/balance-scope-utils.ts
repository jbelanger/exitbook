import { err, ok, type Result } from '@exitbook/core';

import type { DataContext } from '../data-context.js';

export function toBalanceScopeKey(scopeAccountId: number): string {
  return `balance:${scopeAccountId}`;
}

export async function resolveBalanceScopeAccountId(db: DataContext, accountId: number): Promise<Result<number, Error>> {
  const visited = new Set<number>();
  let currentAccountId = accountId;

  while (true) {
    if (visited.has(currentAccountId)) {
      return err(
        new Error(`Circular account hierarchy detected while resolving balance scope for account ${accountId}`)
      );
    }
    visited.add(currentAccountId);

    const accountResult = await db.accounts.findById(currentAccountId);
    if (accountResult.isErr()) {
      return err(accountResult.error);
    }

    const account = accountResult.value;
    if (!account) {
      return err(new Error(`Account ${currentAccountId} not found while resolving balance scope for ${accountId}`));
    }

    if (!account.parentAccountId) {
      return ok(account.id);
    }

    currentAccountId = account.parentAccountId;
  }
}

export async function resolveBalanceScopeAccountIds(
  db: DataContext,
  accountIds?: number[]
): Promise<Result<number[] | undefined, Error>> {
  if (!accountIds) {
    return ok(undefined);
  }

  const scopeIds = new Set<number>();

  for (const accountId of accountIds) {
    const scopeAccountIdResult = await resolveBalanceScopeAccountId(db, accountId);
    if (scopeAccountIdResult.isErr()) {
      return err(scopeAccountIdResult.error);
    }

    scopeIds.add(scopeAccountIdResult.value);
  }

  return ok([...scopeIds]);
}
