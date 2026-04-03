import type { Account, BalanceSnapshot, BalanceSnapshotAsset } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { buildAccountDetailViewItem } from '../accounts-detail-support.js';

function createAccount(overrides: Partial<Account> = {}): Account {
  const id = overrides.id ?? 1;

  return {
    id,
    profileId: overrides.profileId ?? 1,
    name: overrides.name,
    accountType: overrides.accountType ?? 'blockchain',
    platformKey: overrides.platformKey ?? 'bitcoin',
    identifier: overrides.identifier ?? `identifier-${id}`,
    accountFingerprint: overrides.accountFingerprint ?? `${id}`.padStart(64, '0'),
    parentAccountId: overrides.parentAccountId,
    providerName: overrides.providerName,
    credentials: overrides.credentials,
    lastCursor: overrides.lastCursor,
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt,
  };
}

function createSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    accountFingerprint: `${1}`.padStart(64, '0'),
    accountType: 'blockchain' as const,
    platformKey: 'bitcoin',
    name: 'wallet-main',
    identifier: 'bc1qwalletmain',
    parentAccountId: undefined,
    providerName: undefined,
    balanceProjectionStatus: 'fresh' as const,
    balanceProjectionReason: undefined,
    lastCalculatedAt: '2026-03-12T12:00:00.000Z',
    lastRefreshAt: '2026-03-12T12:30:00.000Z',
    storedAssetCount: 1,
    storedBalanceStatusReason: undefined,
    storedBalanceSuggestion: undefined,
    verificationStatus: 'match' as const,
    sessionCount: 0,
    childAccounts: undefined,
    sessions: undefined,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function createSnapshot(scopeAccountId: number, overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    scopeAccountId,
    verificationStatus: 'match',
    matchCount: 1,
    warningCount: 0,
    mismatchCount: 0,
    lastRefreshAt: new Date('2026-03-12T12:30:00.000Z'),
    ...overrides,
  };
}

function createSnapshotAsset(
  scopeAccountId: number,
  assetId: string,
  assetSymbol: string,
  overrides: Partial<BalanceSnapshotAsset> = {}
): BalanceSnapshotAsset {
  return {
    scopeAccountId,
    assetId,
    assetSymbol,
    calculatedBalance: '1.25',
    excludedFromAccounting: false,
    liveBalance: '1.25',
    comparisonStatus: 'match',
    ...overrides,
  };
}

function createAccountService(accounts: Account[]) {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  return {
    findById: vi.fn().mockImplementation(async (accountId: number) => ok(accountsById.get(accountId))),
  };
}

function createMockDatabase(params: {
  accounts: Account[];
  assets: BalanceSnapshotAsset[];
  snapshot?: BalanceSnapshot | undefined;
  staleReason?: string | undefined;
}) {
  return {
    accounts: {
      findAll: vi
        .fn()
        .mockImplementation(async (filters?: { parentAccountId?: number | undefined }) =>
          ok(
            filters?.parentAccountId === undefined
              ? params.accounts
              : params.accounts.filter((account) => account.parentAccountId === filters.parentAccountId)
          )
        ),
    },
    balanceSnapshots: {
      findAssetsByScope: vi
        .fn()
        .mockImplementation(async (scopeAccountIds?: number[]) =>
          ok(
            scopeAccountIds
              ? params.assets.filter((asset) => scopeAccountIds.includes(asset.scopeAccountId))
              : params.assets
          )
        ),
      findSnapshot: vi.fn().mockResolvedValue(ok(params.snapshot)),
    },
    projectionState: {
      find: vi.fn().mockImplementation(async () =>
        ok(
          params.staleReason
            ? {
                projectionId: 'balances',
                scopeKey: 'balance:1',
                status: 'stale',
                lastBuiltAt: undefined,
                lastInvalidatedAt: undefined,
                invalidatedBy: params.staleReason,
                metadata: undefined,
              }
            : undefined
        )
      ),
    },
    transactions: {
      findAll: vi.fn().mockResolvedValue(ok([])),
    },
  } as unknown as DataSession;
}

describe('buildAccountDetailViewItem', () => {
  it('returns readable stored balance detail with live balances and comparison status', async () => {
    const account = createAccount({ id: 1, name: 'wallet-main', identifier: 'bc1qwalletmain' });
    const accountService = createAccountService([account]);
    const database = createMockDatabase({
      accounts: [account],
      snapshot: createSnapshot(1, {
        statusReason: 'Looks good',
        suggestion: 'No action needed',
      }),
      assets: [createSnapshotAsset(1, 'blockchain:bitcoin:native', 'BTC')],
    });

    const result = await buildAccountDetailViewItem({
      accountId: 1,
      accountService: accountService as never,
      database,
      profileId: 1,
      summary: createSummary(),
    });

    const detail = assertOk(result);

    expect(detail.requestedAccount).toBeUndefined();
    expect(detail.balance.readable).toBe(true);
    if (detail.balance.readable) {
      expect(detail.balance.scopeAccount.id).toBe(1);
      expect(detail.balance.statusReason).toBe('Looks good');
      expect(detail.balance.suggestion).toBe('No action needed');
      expect(detail.balance.assets).toEqual([
        expect.objectContaining({
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          calculatedBalance: '1.25',
          liveBalance: '1.25',
          comparisonStatus: 'match',
        }),
      ]);
    }
  });

  it('returns unreadable detail with requested and scope accounts when a child resolves upward', async () => {
    const parent = createAccount({ id: 1, name: 'wallet-main', identifier: 'xpub-parent' });
    const child = createAccount({ id: 2, name: 'wallet-child', identifier: 'bc1-child', parentAccountId: 1 });
    const accountService = createAccountService([parent, child]);
    const database = createMockDatabase({
      accounts: [parent, child],
      snapshot: createSnapshot(1),
      assets: [createSnapshotAsset(1, 'blockchain:bitcoin:native', 'BTC')],
      staleReason: 'upstream-rebuilt:processed-transactions',
    });

    const result = await buildAccountDetailViewItem({
      accountId: 2,
      accountService: accountService as never,
      database,
      profileId: 1,
      summary: createSummary({
        id: 2,
        accountFingerprint: `${2}`.padStart(64, '0'),
        name: 'wallet-child',
        identifier: 'bc1-child',
        parentAccountId: 1,
      }),
    });

    const detail = assertOk(result);

    expect(detail.requestedAccount).toEqual(
      expect.objectContaining({
        id: 2,
        identifier: 'bc1-child',
        name: 'wallet-child',
      })
    );
    expect(detail.balance.readable).toBe(false);
    if (!detail.balance.readable) {
      expect(detail.balance.scopeAccount).toEqual(
        expect.objectContaining({
          id: 1,
          identifier: 'xpub-parent',
          name: 'wallet-main',
        })
      );
      expect(detail.balance.reason).toContain('processed transactions were rebuilt');
      expect(detail.balance.hint).toContain('exitbook accounts refresh');
      expect(detail.balance.hint).toContain('rebuild only the requested scope');
    }
  });
});
