import { err, ok, type Result } from '@exitbook/foundation';
import {
  resolveBalanceScopeAccountId as resolvePortBalanceScopeAccountId,
  type BalanceScopeAccount,
  type IBalanceScopeAccountLookup,
} from '@exitbook/ingestion/ports';

import type { DataSession } from '../data-session.js';

export function toBalanceScopeKey(scopeAccountId: number): string {
  return `balance:${scopeAccountId}`;
}

export async function resolveBalanceScopeAccountId(db: DataSession, accountId: number): Promise<Result<number, Error>> {
  const requestedAccountResult = await loadRequestedAccount(db, accountId);
  if (requestedAccountResult.isErr()) {
    return err(requestedAccountResult.error);
  }

  return resolvePortBalanceScopeAccountId(requestedAccountResult.value, createBalanceScopeLookup(db));
}

export async function resolveBalanceScopeAccountIds(
  db: DataSession,
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

function createBalanceScopeLookup(db: DataSession): IBalanceScopeAccountLookup<BalanceScopeAccount> {
  return {
    findById(id) {
      return db.accounts.findById(id);
    },
  };
}

async function loadRequestedAccount(db: DataSession, accountId: number): Promise<Result<BalanceScopeAccount, Error>> {
  const accountResult = await db.accounts.getById(accountId);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }
  return ok(accountResult.value);
}
