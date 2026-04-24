import type { Account } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';

// ---------------------------------------------------------------------------
// Shared account-scope types
// ---------------------------------------------------------------------------

export type AccountScopeAccount = Pick<Account, 'id' | 'parentAccountId'>;

export interface IAccountScopeAccountLookup<TAccount extends AccountScopeAccount = AccountScopeAccount> {
  findById(id: number): Promise<Result<TAccount | undefined, Error>>;
}

export interface IAccountScopeHierarchyLookup<
  TAccount extends AccountScopeAccount = AccountScopeAccount,
> extends IAccountScopeAccountLookup<TAccount> {
  findChildAccounts(parentAccountId: number): Promise<Result<TAccount[], Error>>;
}

export interface AccountScopeContext<TAccount extends AccountScopeAccount = AccountScopeAccount> {
  memberAccounts: TAccount[];
  requestedAccount: TAccount;
  scopeAccount: TAccount;
}

export interface ResolveAccountScopeOptions {
  cache?: Map<number, number> | undefined;
}

// ---------------------------------------------------------------------------
// Account-scope helpers
// ---------------------------------------------------------------------------

export async function resolveAccountScopeAccountId<TAccount extends AccountScopeAccount>(
  account: TAccount,
  lookup: IAccountScopeAccountLookup<TAccount>,
  options?: ResolveAccountScopeOptions
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
        new Error(`Circular account hierarchy detected while resolving account scope for account ${account.id}`)
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
        new Error(`Account ${currentAccount.parentAccountId} not found while resolving account scope for ${account.id}`)
      );
    }

    currentAccount = parentAccount;
  }
}

export async function resolveAccountScopeAccount<TAccount extends AccountScopeAccount>(
  account: TAccount,
  lookup: IAccountScopeAccountLookup<TAccount>,
  options?: ResolveAccountScopeOptions
): Promise<Result<TAccount, Error>> {
  const scopeAccountIdResult = await resolveAccountScopeAccountId(account, lookup, options);
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
      new Error(`Account ${scopeAccountIdResult.value} not found while resolving account scope for ${account.id}`)
    );
  }

  return ok(scopeAccount);
}

export async function loadAccountScopeContext<TAccount extends AccountScopeAccount>(
  requestedAccount: TAccount,
  lookup: IAccountScopeHierarchyLookup<TAccount>,
  options?: ResolveAccountScopeOptions
): Promise<Result<AccountScopeContext<TAccount>, Error>> {
  const scopeAccountResult = await resolveAccountScopeAccount(requestedAccount, lookup, options);
  if (scopeAccountResult.isErr()) {
    return err(scopeAccountResult.error);
  }

  const memberAccountsResult = await loadAccountScopeMemberAccounts(scopeAccountResult.value, lookup);
  if (memberAccountsResult.isErr()) {
    return err(memberAccountsResult.error);
  }

  return ok({
    requestedAccount,
    scopeAccount: scopeAccountResult.value,
    memberAccounts: memberAccountsResult.value,
  });
}

export async function loadAccountScopeMemberAccounts<TAccount extends Pick<AccountScopeAccount, 'id'>>(
  scopeAccount: TAccount,
  lookup: Pick<IAccountScopeHierarchyLookup<TAccount>, 'findChildAccounts'>
): Promise<Result<TAccount[], Error>> {
  const descendantAccountsResult = await loadDescendantAccounts(scopeAccount.id, lookup, new Set([scopeAccount.id]));
  if (descendantAccountsResult.isErr()) {
    return err(descendantAccountsResult.error);
  }

  return ok([scopeAccount, ...descendantAccountsResult.value]);
}

async function loadDescendantAccounts<TAccount extends Pick<AccountScopeAccount, 'id'>>(
  parentAccountId: number,
  lookup: Pick<IAccountScopeHierarchyLookup<TAccount>, 'findChildAccounts'>,
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
