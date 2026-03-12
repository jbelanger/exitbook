import type { Account, BalanceSnapshot, BalanceSnapshotAsset } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import type { DataContext } from '@exitbook/data';
import { describe, expect, it, vi } from 'vitest';

import { BalanceHandler } from '../balance-handler.js';

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 1,
    accountType: overrides.accountType ?? 'blockchain',
    sourceName: overrides.sourceName ?? 'bitcoin',
    identifier: overrides.identifier ?? `identifier-${overrides.id ?? 1}`,
    parentAccountId: overrides.parentAccountId,
    providerName: overrides.providerName,
    credentials: overrides.credentials,
    lastCursor: overrides.lastCursor,
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt,
  };
}

function createSnapshot(scopeAccountId: number): BalanceSnapshot {
  return {
    scopeAccountId,
    verificationStatus: 'match',
    matchCount: 1,
    warningCount: 0,
    mismatchCount: 0,
  };
}

function createSnapshotAsset(scopeAccountId: number, assetId: string, assetSymbol: string): BalanceSnapshotAsset {
  return {
    scopeAccountId,
    assetId,
    assetSymbol,
    calculatedBalance: '1',
    excludedFromAccounting: false,
  };
}

function createMockDb(params: {
  accounts: Account[];
  childAccountError?: Error;
  snapshotAssets: BalanceSnapshotAsset[];
  snapshots: BalanceSnapshot[];
  staleScopes?: Map<number, string>;
  transactionError?: Error;
}) {
  const accountsById = new Map(params.accounts.map((account) => [account.id, account]));
  const snapshotsByScopeId = new Map(params.snapshots.map((snapshot) => [snapshot.scopeAccountId, snapshot]));

  return {
    accounts: {
      findAll: vi.fn().mockImplementation(async (filters?: { parentAccountId?: number | undefined }) => {
        if (filters?.parentAccountId !== undefined) {
          if (params.childAccountError) {
            return err(params.childAccountError);
          }
          return ok(params.accounts.filter((account) => account.parentAccountId === filters.parentAccountId));
        }

        return ok(params.accounts);
      }),
      findById: vi.fn().mockImplementation(async (accountId: number) => ok(accountsById.get(accountId))),
      findByIdOptional: vi.fn().mockImplementation(async (accountId: number) => ok(accountsById.get(accountId))),
    },
    balanceSnapshots: {
      findAssetsByScope: vi
        .fn()
        .mockImplementation(async (scopeAccountIds?: number[]) =>
          ok(
            scopeAccountIds
              ? params.snapshotAssets.filter((asset) => scopeAccountIds.includes(asset.scopeAccountId))
              : params.snapshotAssets
          )
        ),
      findSnapshot: vi
        .fn()
        .mockImplementation(async (scopeAccountId: number) => ok(snapshotsByScopeId.get(scopeAccountId))),
    },
    projectionState: {
      get: vi.fn().mockImplementation(async (_projectionId: string, scopeKey: string) => {
        const scopeAccountId = Number(scopeKey.replace('balance:', ''));
        const reason = params.staleScopes?.get(scopeAccountId);
        if (!reason) {
          return ok(undefined);
        }

        return ok({
          projectionId: 'balances',
          scopeKey,
          status: 'stale',
          lastBuiltAt: undefined,
          lastInvalidatedAt: undefined,
          invalidatedBy: reason,
          metadata: undefined,
        });
      }),
    },
    transactions: {
      findAll: vi.fn().mockResolvedValue(params.transactionError ? err(params.transactionError) : ok([])),
    },
  };
}

describe('BalanceHandler.viewStoredSnapshots', () => {
  it('does not fall back to child snapshot rows when the owning scope snapshot is missing', async () => {
    const parentAccount = createAccount({ id: 1, identifier: 'xpub-parent' });
    const childAccount = createAccount({ id: 2, identifier: 'bc1-child', parentAccountId: parentAccount.id });
    const mockDb = createMockDb({
      accounts: [parentAccount, childAccount],
      snapshots: [createSnapshot(childAccount.id)],
      snapshotAssets: [createSnapshotAsset(childAccount.id, 'blockchain:bitcoin:native', 'BTC')],
    });

    const handler = new BalanceHandler(mockDb as unknown as DataContext, undefined);
    const result = await handler.viewStoredSnapshots({ accountId: childAccount.id });
    const error = assertErr(result);

    expect(error.message).toContain('scope account #1');
    expect(error.message).toContain('balance snapshot has never been built');
    expect(error.message).toContain('balance refresh --account-id 2');
  });

  it('reads the root scope snapshot for nested child accounts', async () => {
    const rootAccount = createAccount({ id: 1, identifier: 'xpub-root' });
    const childAccount = createAccount({ id: 2, identifier: 'bc1-child', parentAccountId: rootAccount.id });
    const grandchildAccount = createAccount({ id: 3, identifier: 'bc1-grandchild', parentAccountId: childAccount.id });
    const mockDb = createMockDb({
      accounts: [rootAccount, childAccount, grandchildAccount],
      snapshots: [createSnapshot(rootAccount.id)],
      snapshotAssets: [createSnapshotAsset(rootAccount.id, 'blockchain:bitcoin:native', 'BTC')],
    });

    const handler = new BalanceHandler(mockDb as unknown as DataContext, undefined);
    const result = await handler.viewStoredSnapshots({ accountId: grandchildAccount.id });
    const value = assertOk(result);

    expect(value.accounts).toHaveLength(1);
    expect(value.accounts[0]).toMatchObject({
      account: {
        id: rootAccount.id,
      },
      requestedAccount: {
        id: grandchildAccount.id,
      },
    });
    expect(value.accounts[0]?.assets).toHaveLength(1);
    expect(value.accounts[0]?.assets[0]).toMatchObject({
      assetId: 'blockchain:bitcoin:native',
      calculatedBalance: '1',
    });
  });

  it('fails when stored-snapshot diagnostics cannot load transactions', async () => {
    const account = createAccount({ id: 1, identifier: 'bc1-root' });
    const mockDb = createMockDb({
      accounts: [account],
      snapshots: [createSnapshot(account.id)],
      snapshotAssets: [createSnapshotAsset(account.id, 'blockchain:bitcoin:native', 'BTC')],
      transactionError: new Error('transactions unavailable'),
    });

    const handler = new BalanceHandler(mockDb as unknown as DataContext, undefined);
    const result = await handler.viewStoredSnapshots({ accountId: account.id });
    const error = assertErr(result);

    expect(error.message).toBe('Failed to load transactions for diagnostics for account #1: transactions unavailable');
  });

  it('fails when stored-snapshot diagnostics cannot load descendant accounts', async () => {
    const account = createAccount({ id: 1, identifier: 'bc1-root' });
    const mockDb = createMockDb({
      accounts: [account],
      snapshots: [createSnapshot(account.id)],
      snapshotAssets: [createSnapshotAsset(account.id, 'blockchain:bitcoin:native', 'BTC')],
      childAccountError: new Error('child lookup failed'),
    });

    const handler = new BalanceHandler(mockDb as unknown as DataContext, undefined);
    const result = await handler.viewStoredSnapshots({ accountId: account.id });
    const error = assertErr(result);

    expect(error.message).toBe(
      'Failed to load descendant accounts for diagnostics for account #1: child lookup failed'
    );
  });
});
