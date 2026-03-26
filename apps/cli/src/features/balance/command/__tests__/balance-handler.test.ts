import type { Account, BalanceSnapshot, BalanceSnapshotAsset } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { BalanceHandler } from '../balance-handler.js';

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 1,
    profileId: overrides.profileId ?? 1,
    accountType: overrides.accountType ?? 'blockchain',
    platformKey: overrides.platformKey ?? 'bitcoin',
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
  const accountService = createMockAccountService(params.accounts);

  return {
    accountService,
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
      getById: vi.fn().mockImplementation(async (accountId: number) => ok(accountsById.get(accountId))),
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

function createMockAccountService(accounts: Account[]) {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  return {
    listTopLevel: vi
      .fn()
      .mockImplementation(async (profileId: number) =>
        ok(accounts.filter((account) => account.profileId === profileId && !account.parentAccountId))
      ),
    requireOwned: vi.fn().mockImplementation(async (profileId: number, accountId: number) => {
      const account = accountsById.get(accountId);
      if (!account || account.profileId !== profileId) {
        return err(new Error(`Account ${accountId} does not belong to the selected profile`));
      }

      return ok(account);
    }),
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

    const handler = new BalanceHandler(mockDb as unknown as DataSession, undefined, mockDb.accountService);
    const result = await handler.viewStoredSnapshots({ accountId: childAccount.id, profileId: 1 });
    const error = assertErr(result);

    expect(error.message).toContain('scope account #1');
    expect(error.message).toContain('has not been built yet');
    expect(error.message).toContain('balance refresh --account-id 2');
    expect(error.message).not.toContain('is stale');
  });

  it('rebuilds the initial stored snapshot automatically when a workflow is available', async () => {
    const parentAccount = createAccount({ id: 1, identifier: 'xpub-parent' });
    const childAccount = createAccount({ id: 2, identifier: 'bc1-child', parentAccountId: parentAccount.id });
    const snapshotsByScopeId = new Map<number, BalanceSnapshot>();
    const snapshotAssets: BalanceSnapshotAsset[] = [];
    const accounts = [parentAccount, childAccount];
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const accountService = createMockAccountService(accounts);
    const mockDb = {
      accounts: {
        findAll: vi.fn().mockImplementation(async (filters?: { parentAccountId?: number | undefined }) => {
          if (filters?.parentAccountId !== undefined) {
            return ok(accounts.filter((account) => account.parentAccountId === filters.parentAccountId));
          }

          return ok(accounts);
        }),
        findById: vi.fn().mockImplementation(async (accountId: number) => ok(accountsById.get(accountId))),
        getById: vi.fn().mockImplementation(async (accountId: number) => ok(accountsById.get(accountId))),
        findByIdOptional: vi.fn().mockImplementation(async (accountId: number) => ok(accountsById.get(accountId))),
      },
      balanceSnapshots: {
        findAssetsByScope: vi
          .fn()
          .mockImplementation(async (scopeAccountIds?: number[]) =>
            ok(
              scopeAccountIds
                ? snapshotAssets.filter((asset) => scopeAccountIds.includes(asset.scopeAccountId))
                : snapshotAssets
            )
          ),
        findSnapshot: vi
          .fn()
          .mockImplementation(async (scopeAccountId: number) => ok(snapshotsByScopeId.get(scopeAccountId))),
      },
      projectionState: {
        get: vi.fn().mockImplementation(async () =>
          ok(
            snapshotsByScopeId.has(parentAccount.id)
              ? undefined
              : {
                  projectionId: 'balances',
                  scopeKey: 'balance:1',
                  status: 'stale',
                  lastBuiltAt: undefined,
                  lastInvalidatedAt: undefined,
                  invalidatedBy: 'upstream-rebuilt:processed-transactions',
                  metadata: undefined,
                }
          )
        ),
      },
      transactions: {
        findAll: vi.fn().mockResolvedValue(ok([])),
      },
    };
    const balanceOperation = {
      rebuildCalculatedSnapshot: vi.fn().mockImplementation(async ({ accountId }: { accountId: number }) => {
        expect(accountId).toBe(childAccount.id);
        snapshotsByScopeId.set(parentAccount.id, createSnapshot(parentAccount.id));
        snapshotAssets.push(createSnapshotAsset(parentAccount.id, 'blockchain:bitcoin:native', 'BTC'));
        return ok({
          requestedAccount: childAccount,
          scopeAccount: parentAccount,
          assetCount: 1,
        });
      }),
    };

    const handler = new BalanceHandler(mockDb as unknown as DataSession, balanceOperation as never, accountService);
    const result = await handler.viewStoredSnapshots({ accountId: childAccount.id, profileId: 1 });
    const value = assertOk(result);

    expect(balanceOperation.rebuildCalculatedSnapshot).toHaveBeenCalledWith({ accountId: childAccount.id });
    expect(value.accounts).toHaveLength(1);
    expect(value.accounts[0]).toMatchObject({
      account: {
        id: parentAccount.id,
      },
      requestedAccount: {
        id: childAccount.id,
      },
    });
    expect(value.accounts[0]?.assets).toHaveLength(1);
  });

  it('reports a missing stored snapshot even when projection freshness was invalidated globally', async () => {
    const account = createAccount({ id: 1, platformKey: 'kraken' });
    const mockDb = createMockDb({
      accounts: [account],
      snapshots: [],
      snapshotAssets: [],
      staleScopes: new Map([[account.id, 'upstream-rebuilt:processed-transactions']]),
    });

    const handler = new BalanceHandler(mockDb as unknown as DataSession, undefined, mockDb.accountService);
    const result = await handler.viewStoredSnapshots({ accountId: account.id, profileId: 1 });
    const error = assertErr(result);

    expect(error.message).toContain('has not been built yet');
    expect(error.message).toContain('balance refresh --account-id 1');
    expect(error.message).not.toContain('invalidated stored balance snapshots for all scopes');
  });

  it('explains when processed-transaction resets invalidate every stored balance snapshot', async () => {
    const account = createAccount({ id: 1, platformKey: 'kraken' });
    const mockDb = createMockDb({
      accounts: [account],
      snapshots: [createSnapshot(account.id)],
      snapshotAssets: [createSnapshotAsset(account.id, 'exchange:kraken:btc', 'BTC')],
      staleScopes: new Map([[account.id, 'upstream-reset:processed-transactions']]),
    });

    const handler = new BalanceHandler(mockDb as unknown as DataSession, undefined, mockDb.accountService);
    const result = await handler.viewStoredSnapshots({ accountId: account.id, profileId: 1 });
    const error = assertErr(result);

    expect(error.message).toContain('invalidated stored balance snapshots for all scopes');
    expect(error.message).toContain('exitbook balance refresh" to rebuild all stored balances');
    expect(error.message).toContain('exitbook balance refresh --account-id 1');
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

    const handler = new BalanceHandler(mockDb as unknown as DataSession, undefined, mockDb.accountService);
    const result = await handler.viewStoredSnapshots({ accountId: grandchildAccount.id, profileId: 1 });
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

    const handler = new BalanceHandler(mockDb as unknown as DataSession, undefined, mockDb.accountService);
    const result = await handler.viewStoredSnapshots({ accountId: account.id, profileId: 1 });
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

    const handler = new BalanceHandler(mockDb as unknown as DataSession, undefined, mockDb.accountService);
    const result = await handler.viewStoredSnapshots({ accountId: account.id, profileId: 1 });
    const error = assertErr(result);

    expect(error.message).toBe(
      'Failed to load descendant accounts for diagnostics for account #1: child lookup failed'
    );
  });

  it('rejects reading a snapshot for an account outside the selected profile', async () => {
    const account = createAccount({ id: 99, profileId: 2, identifier: 'bc1-other-profile' });
    const mockDb = createMockDb({
      accounts: [account],
      snapshots: [createSnapshot(account.id)],
      snapshotAssets: [createSnapshotAsset(account.id, 'blockchain:bitcoin:native', 'BTC')],
    });

    const handler = new BalanceHandler(mockDb as unknown as DataSession, undefined, mockDb.accountService);
    const result = await handler.viewStoredSnapshots({ accountId: account.id, profileId: 1 });
    const error = assertErr(result);

    expect(error.message).toContain('does not belong to the selected profile');
  });
});

describe('BalanceHandler.refreshAllScopes', () => {
  it('counts calculated-only warning results as verified totals', async () => {
    const account = createAccount({ id: 74, platformKey: 'lukso', identifier: '0xlukso' });
    const mockDb = createMockDb({
      accounts: [account],
      snapshots: [],
      snapshotAssets: [],
    });
    const balanceOperation = {
      refreshVerification: vi.fn().mockResolvedValue(
        ok({
          account,
          mode: 'calculated-only',
          timestamp: Date.now(),
          status: 'warning',
          comparisons: [],
          coverage: {
            status: 'partial',
            confidence: 'low',
            requestedAddresses: 1,
            successfulAddresses: 0,
            failedAddresses: 1,
            totalAssets: 1,
            parsedAssets: 0,
            failedAssets: 1,
            overallCoverageRatio: 0,
          },
          summary: {
            matches: 0,
            mismatches: 0,
            warnings: 0,
            totalCurrencies: 1,
          },
          warnings: [
            'Live balance verification is unavailable for lukso: no registered provider supports getAddressBalances. Stored calculated balances only.',
          ],
        })
      ),
    };

    const handler = new BalanceHandler(
      mockDb as unknown as DataSession,
      balanceOperation as never,
      mockDb.accountService
    );
    const result = await handler.refreshAllScopes(1);
    const value = assertOk(result);

    expect(value.totals).toMatchObject({
      total: 1,
      verified: 1,
      skipped: 0,
      matches: 0,
      mismatches: 1,
    });
    expect(value.accounts[0]).toMatchObject({
      accountId: account.id,
      status: 'warning',
    });
  });
});
