import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  loadAccountScopeContext,
  resolveAccountScopeAccountId,
  type AccountScopeAccount,
  type IAccountScopeHierarchyLookup,
} from '../account-scope.js';

interface TestAccount extends AccountScopeAccount {
  label: string;
}

function createAccount(id: number, parentAccountId?: number): TestAccount {
  return {
    id,
    parentAccountId,
    label: `account-${id}`,
  };
}

function createLookup(accounts: TestAccount[]): IAccountScopeHierarchyLookup<TestAccount> & {
  findById: ReturnType<typeof vi.fn<(id: number) => Promise<ReturnType<typeof ok<TestAccount | undefined>>>>>;
} {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  return {
    findById: vi.fn(async (id: number) => ok(accountsById.get(id))),
    findChildAccounts: vi.fn(async (parentAccountId: number) =>
      ok(accounts.filter((account) => account.parentAccountId === parentAccountId))
    ),
  };
}

describe('account-scope helpers', () => {
  it('resolves a nested child to the owning root scope and loads all scope members', async () => {
    const root = createAccount(1);
    const child = createAccount(2, root.id);
    const grandchild = createAccount(3, child.id);
    const lookup = createLookup([root, child, grandchild]);

    const scopeAccountId = assertOk(await resolveAccountScopeAccountId(grandchild, lookup));
    const scopeContext = assertOk(await loadAccountScopeContext(grandchild, lookup));

    expect(scopeAccountId).toBe(root.id);
    expect(scopeContext.scopeAccount.id).toBe(root.id);
    expect(scopeContext.memberAccounts.map((account) => account.id)).toEqual([root.id, child.id, grandchild.id]);
  });

  it('fails when a parent walk contains a cycle', async () => {
    const root = createAccount(1, 2);
    const child = createAccount(2, 1);
    const lookup = createLookup([root, child]);

    const error = assertErr(await resolveAccountScopeAccountId(child, lookup));

    expect(error.message).toContain('Circular account hierarchy detected while resolving account scope');
  });

  it('fails when descendant loading contains a cycle', async () => {
    const root = createAccount(1);
    const child = createAccount(2, root.id);
    const lookup: IAccountScopeHierarchyLookup<TestAccount> = {
      findById: vi.fn(async (id: number) => ok(id === root.id ? root : child)),
      findChildAccounts: vi.fn(async (parentAccountId: number) => {
        if (parentAccountId === root.id) {
          return ok([child]);
        }
        if (parentAccountId === child.id) {
          return ok([root]);
        }
        return err(new Error(`Unexpected parent account ${parentAccountId}`));
      }),
    };

    const error = assertErr(await loadAccountScopeContext(root, lookup));

    expect(error.message).toContain('Circular account hierarchy detected while loading descendants');
  });
});
