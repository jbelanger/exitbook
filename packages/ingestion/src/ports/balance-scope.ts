import type { Account, Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';

// ---------------------------------------------------------------------------
// Shared balance-scope types
// ---------------------------------------------------------------------------

export type BalanceScopeAccount = Pick<Account, 'id' | 'parentAccountId'>;

export interface IBalanceScopeAccountLookup<TAccount extends BalanceScopeAccount = BalanceScopeAccount> {
  findById(id: number): Promise<Result<TAccount | undefined, Error>>;
}

export interface IBalanceScopeHierarchyLookup<
  TAccount extends BalanceScopeAccount = BalanceScopeAccount,
> extends IBalanceScopeAccountLookup<TAccount> {
  findChildAccounts(parentAccountId: number): Promise<Result<TAccount[], Error>>;
}

export interface BalanceScopeContext<TAccount extends BalanceScopeAccount = BalanceScopeAccount> {
  memberAccounts: TAccount[];
  requestedAccount: TAccount;
  scopeAccount: TAccount;
}

export interface ResolveBalanceScopeOptions {
  cache?: Map<number, number> | undefined;
}

// ---------------------------------------------------------------------------
// Balance-scope helpers
// ---------------------------------------------------------------------------

export async function resolveBalanceScopeAccountId<TAccount extends BalanceScopeAccount>(
  account: TAccount,
  lookup: IBalanceScopeAccountLookup<TAccount>,
  options?: ResolveBalanceScopeOptions
): Promise<Result<number, Error>> {
  const cache = options?.cache;
  const visited = new Set<number>();
  const path: number[] = [];
  let currentAccount = account;

  while (true) {
    const cachedScopeAccountId = cache?.get(currentAccount.id);
    if (cachedScopeAccountId !== undefined) {
      cacheResolvedScopeIds(path, cachedScopeAccountId, cache);
      return ok(cachedScopeAccountId);
    }

    if (visited.has(currentAccount.id)) {
      return err(
        new Error(`Circular account hierarchy detected while resolving balance scope for account ${account.id}`)
      );
    }

    visited.add(currentAccount.id);
    path.push(currentAccount.id);

    if (!currentAccount.parentAccountId) {
      cacheResolvedScopeIds(path, currentAccount.id, cache);
      return ok(currentAccount.id);
    }

    const parentAccountResult = await lookup.findById(currentAccount.parentAccountId);
    if (parentAccountResult.isErr()) {
      return err(parentAccountResult.error);
    }

    const parentAccount = parentAccountResult.value;
    if (!parentAccount) {
      return err(
        new Error(`Account ${currentAccount.parentAccountId} not found while resolving balance scope for ${account.id}`)
      );
    }

    currentAccount = parentAccount;
  }
}

export async function resolveBalanceScopeAccount<TAccount extends BalanceScopeAccount>(
  account: TAccount,
  lookup: IBalanceScopeAccountLookup<TAccount>,
  options?: ResolveBalanceScopeOptions
): Promise<Result<TAccount, Error>> {
  const scopeAccountIdResult = await resolveBalanceScopeAccountId(account, lookup, options);
  if (scopeAccountIdResult.isErr()) {
    return err(scopeAccountIdResult.error);
  }

  if (scopeAccountIdResult.value === account.id) {
    return ok(account);
  }

  const scopeAccountResult = await lookup.findById(scopeAccountIdResult.value);
  if (scopeAccountResult.isErr()) {
    return err(scopeAccountResult.error);
  }

  const scopeAccount = scopeAccountResult.value;
  if (!scopeAccount) {
    return err(
      new Error(`Account ${scopeAccountIdResult.value} not found while resolving balance scope for ${account.id}`)
    );
  }

  return ok(scopeAccount);
}

export async function loadBalanceScopeContext<TAccount extends BalanceScopeAccount>(
  requestedAccount: TAccount,
  lookup: IBalanceScopeHierarchyLookup<TAccount>,
  options?: ResolveBalanceScopeOptions
): Promise<Result<BalanceScopeContext<TAccount>, Error>> {
  const scopeAccountResult = await resolveBalanceScopeAccount(requestedAccount, lookup, options);
  if (scopeAccountResult.isErr()) {
    return err(scopeAccountResult.error);
  }

  const memberAccountsResult = await loadBalanceScopeMemberAccounts(scopeAccountResult.value, lookup);
  if (memberAccountsResult.isErr()) {
    return err(memberAccountsResult.error);
  }

  return ok({
    requestedAccount,
    scopeAccount: scopeAccountResult.value,
    memberAccounts: memberAccountsResult.value,
  });
}

export async function loadBalanceScopeMemberAccounts<TAccount extends Pick<BalanceScopeAccount, 'id'>>(
  scopeAccount: TAccount,
  lookup: Pick<IBalanceScopeHierarchyLookup<TAccount>, 'findChildAccounts'>
): Promise<Result<TAccount[], Error>> {
  const descendantAccountsResult = await loadDescendantAccounts(scopeAccount.id, lookup, new Set([scopeAccount.id]));
  if (descendantAccountsResult.isErr()) {
    return err(descendantAccountsResult.error);
  }

  return ok([scopeAccount, ...descendantAccountsResult.value]);
}

async function loadDescendantAccounts<TAccount extends Pick<BalanceScopeAccount, 'id'>>(
  parentAccountId: number,
  lookup: Pick<IBalanceScopeHierarchyLookup<TAccount>, 'findChildAccounts'>,
  visited: Set<number>
): Promise<Result<TAccount[], Error>> {
  const childAccountsResult = await lookup.findChildAccounts(parentAccountId);
  if (childAccountsResult.isErr()) {
    return err(childAccountsResult.error);
  }

  const descendants: TAccount[] = [];

  for (const childAccount of childAccountsResult.value) {
    if (visited.has(childAccount.id)) {
      return err(
        new Error(`Circular account hierarchy detected while loading descendants for account ${parentAccountId}`)
      );
    }

    visited.add(childAccount.id);
    descendants.push(childAccount);

    const nestedDescendantsResult = await loadDescendantAccounts(childAccount.id, lookup, visited);
    if (nestedDescendantsResult.isErr()) {
      return err(nestedDescendantsResult.error);
    }

    descendants.push(...nestedDescendantsResult.value);
  }

  return ok(descendants);
}

function cacheResolvedScopeIds(accountIds: number[], scopeAccountId: number, cache?: Map<number, number>): void {
  if (!cache) {
    return;
  }

  for (const accountId of accountIds) {
    cache.set(accountId, scopeAccountId);
  }
}
