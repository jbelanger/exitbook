import { err, ok, type Result } from '@exitbook/foundation';
import {
  resolveBalanceScopeAccountId as resolvePortBalanceScopeAccountId,
  type BalanceScopeAccount,
  type IBalanceScopeAccountLookup,
} from '@exitbook/ingestion/ports';

import type { DataContext } from '../data-context.js';

export function toBalanceScopeKey(scopeAccountId: number): string {
  return `balance:${scopeAccountId}`;
}

export async function resolveBalanceScopeAccountId(db: DataContext, accountId: number): Promise<Result<number, Error>> {
  const requestedAccountResult = await loadRequestedAccount(db, accountId);
  if (requestedAccountResult.isErr()) {
    return err(requestedAccountResult.error);
  }

  return resolvePortBalanceScopeAccountId(requestedAccountResult.value, createBalanceScopeLookup(db));
}

export async function resolveBalanceScopeAccountIds(
  db: DataContext,
  accountIds?: number[]
): Promise<Result<number[] | undefined, Error>> {
  if (!accountIds) {
    return ok(undefined);
  }

  const lookup = createBalanceScopeLookup(db);
  const scopeIds = new Set<number>();
  const scopeCache = new Map<number, number>();

  for (const accountId of accountIds) {
    const requestedAccountResult = await loadRequestedAccount(db, accountId);
    if (requestedAccountResult.isErr()) {
      return err(requestedAccountResult.error);
    }

    const scopeAccountIdResult = await resolvePortBalanceScopeAccountId(requestedAccountResult.value, lookup, {
      cache: scopeCache,
    });
    if (scopeAccountIdResult.isErr()) {
      return err(scopeAccountIdResult.error);
    }

    scopeIds.add(scopeAccountIdResult.value);
  }

  return ok([...scopeIds]);
}

function createBalanceScopeLookup(db: DataContext): IBalanceScopeAccountLookup<BalanceScopeAccount> {
  return {
    findById(id) {
      return db.accounts.findByIdOptional(id);
    },
  };
}

async function loadRequestedAccount(db: DataContext, accountId: number): Promise<Result<BalanceScopeAccount, Error>> {
  const accountResult = await db.accounts.findById(accountId);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }

  if (!accountResult.value) {
    return err(new Error(`Account ${accountId} not found while resolving balance scope for ${accountId}`));
  }

  return ok(accountResult.value);
}
