import type { Account, BalanceSnapshot, BalanceSnapshotAsset } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { ok } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import { AccountsReconcileRunner } from '../accounts-reconcile-runner.js';
import type { AccountsReconcileOptions } from '../accounts-reconcile-types.js';

const STORED_RECONCILE_OPTIONS: AccountsReconcileOptions = {
  includeMatchedRows: false,
  referenceSource: 'stored',
  strict: false,
};

const LIVE_RECONCILE_OPTIONS: AccountsReconcileOptions = {
  includeMatchedRows: false,
  referenceSource: 'live',
  strict: false,
};

function createAccount(overrides: Partial<Account> & Pick<Account, 'id'>): Account {
  return {
    id: overrides.id,
    profileId: overrides.profileId ?? 1,
    name: overrides.name ?? `account-${overrides.id}`,
    parentAccountId: overrides.parentAccountId,
    accountType: overrides.accountType ?? 'blockchain',
    platformKey: overrides.platformKey ?? 'ethereum',
    identifier: overrides.identifier ?? `identifier-${overrides.id}`,
    accountFingerprint: overrides.accountFingerprint ?? `account-fingerprint-${overrides.id}`,
    providerName: overrides.providerName,
    credentials: overrides.credentials,
    lastCursor: overrides.lastCursor,
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? new Date('2026-04-26T00:00:00.000Z'),
    updatedAt: overrides.updatedAt,
  };
}

function createLedgerPosting(overrides: {
  assetId: string;
  assetSymbol: string;
  balanceCategory?: 'liquid' | 'reward_receivable' | 'staked' | 'unbonding' | undefined;
  ownerAccountId: number;
  quantity: string;
}) {
  const stableKey = `${overrides.ownerAccountId}:${overrides.assetId}:${overrides.balanceCategory ?? 'liquid'}`;

  return {
    ownerAccountId: overrides.ownerAccountId,
    sourceActivityId: 1,
    sourceActivityFingerprint: `source:${stableKey}`,
    journalId: 1,
    journalFingerprint: `journal:${stableKey}`,
    journalStableKey: `journal-stable:${stableKey}`,
    journalKind: 'transfer' as const,
    postingId: 1,
    postingFingerprint: `posting:${stableKey}`,
    postingStableKey: `posting-stable:${stableKey}`,
    assetId: overrides.assetId,
    assetSymbol: overrides.assetSymbol,
    quantity: new Decimal(overrides.quantity),
    role: 'principal' as const,
    balanceCategory: overrides.balanceCategory ?? 'liquid',
    settlement: 'on-chain' as const,
  };
}

function createSnapshot(scopeAccountId: number, overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    scopeAccountId,
    calculatedAt: overrides.calculatedAt ?? new Date('2026-04-26T01:00:00.000Z'),
    lastRefreshAt: overrides.lastRefreshAt ?? new Date('2026-04-26T02:00:00.000Z'),
    verificationStatus: overrides.verificationStatus ?? 'match',
    coverageStatus: overrides.coverageStatus,
    coverageConfidence: overrides.coverageConfidence,
    requestedAddressCount: overrides.requestedAddressCount,
    successfulAddressCount: overrides.successfulAddressCount,
    failedAddressCount: overrides.failedAddressCount,
    totalAssetCount: overrides.totalAssetCount,
    parsedAssetCount: overrides.parsedAssetCount,
    failedAssetCount: overrides.failedAssetCount,
    matchCount: overrides.matchCount ?? 0,
    warningCount: overrides.warningCount ?? 0,
    mismatchCount: overrides.mismatchCount ?? 0,
    statusReason: overrides.statusReason,
    suggestion: overrides.suggestion,
    lastError: overrides.lastError,
  };
}

function createSnapshotAsset(overrides: Partial<BalanceSnapshotAsset> & Pick<BalanceSnapshotAsset, 'assetId'>) {
  return {
    scopeAccountId: overrides.scopeAccountId ?? 1,
    assetId: overrides.assetId,
    assetSymbol: overrides.assetSymbol ?? overrides.assetId,
    calculatedBalance: overrides.calculatedBalance ?? '0',
    liveBalance: overrides.liveBalance,
    difference: overrides.difference,
    comparisonStatus: overrides.comparisonStatus,
    excludedFromAccounting: overrides.excludedFromAccounting ?? false,
  };
}

function createDataSessionMock(params: {
  accounts: Account[];
  assets?: BalanceSnapshotAsset[] | undefined;
  postingsByAccountId?: Map<number, unknown[]> | undefined;
  snapshotsByScopeAccountId?: Map<number, BalanceSnapshot | undefined> | undefined;
}): DataSession {
  return {
    accounts: {
      findById: vi.fn(async (id: number) => ok(params.accounts.find((account) => account.id === id))),
      findAll: vi.fn(async (filter: { parentAccountId?: number | undefined; profileId?: number | undefined }) =>
        ok(
          params.accounts.filter(
            (account) =>
              account.parentAccountId === filter.parentAccountId &&
              (filter.profileId === undefined || account.profileId === filter.profileId)
          )
        )
      ),
    },
    accountingLedger: {
      findPostingsByOwnerAccountId: vi.fn(async (ownerAccountId: number) =>
        ok(params.postingsByAccountId?.get(ownerAccountId) ?? [])
      ),
    },
    balanceSnapshots: {
      findSnapshot: vi.fn(async (scopeAccountId: number) => ok(params.snapshotsByScopeAccountId?.get(scopeAccountId))),
      findAssetsByScope: vi.fn(async (scopeAccountIds: number[]) =>
        ok((params.assets ?? []).filter((asset) => scopeAccountIds.includes(asset.scopeAccountId)))
      ),
    },
  } as unknown as DataSession;
}

describe('AccountsReconcileRunner', () => {
  it('compares ledger balances against stored live snapshot rows', async () => {
    const account = createAccount({ id: 1, name: 'wallet-main' });
    const runner = new AccountsReconcileRunner({
      db: createDataSessionMock({
        accounts: [account],
        postingsByAccountId: new Map([
          [
            1,
            [
              createLedgerPosting({
                ownerAccountId: 1,
                assetId: 'eip155:1/slip44:60',
                assetSymbol: 'ETH',
                quantity: '10',
              }),
            ],
          ],
        ]),
        snapshotsByScopeAccountId: new Map([[1, createSnapshot(1)]]),
        assets: [
          createSnapshotAsset({
            scopeAccountId: 1,
            assetId: 'eip155:1/slip44:60',
            assetSymbol: 'ETH',
            liveBalance: '8.5',
          }),
        ],
      }),
    });

    const result = assertOk(await runner.reconcileAccounts([account], STORED_RECONCILE_OPTIONS));

    expect(result.status).toBe('issues');
    expect(result.summary.quantityMismatches).toBe(1);
    expect(result.summary.totalRows).toBe(1);
    expect(result.scopes[0]?.diagnostics.postingRefs).toBe(1);
    expect(result.scopes[0]?.rows[0]).toMatchObject({
      assetSymbol: 'ETH',
      balanceCategory: 'liquid',
      diffQuantity: '1.5',
      expectedQuantity: '10',
      referenceQuantity: '8.5',
      status: 'quantity_mismatch',
    });
  });

  it('keeps non-liquid ledger categories visible when stored references cannot represent them', async () => {
    const account = createAccount({ id: 1, name: 'cosmos-main', platformKey: 'cosmos' });
    const runner = new AccountsReconcileRunner({
      db: createDataSessionMock({
        accounts: [account],
        postingsByAccountId: new Map([
          [
            1,
            [
              createLedgerPosting({
                ownerAccountId: 1,
                assetId: 'cosmos:cosmoshub-4/slip44:118',
                assetSymbol: 'ATOM',
                balanceCategory: 'staked',
                quantity: '25',
              }),
            ],
          ],
        ]),
        snapshotsByScopeAccountId: new Map([[1, createSnapshot(1)]]),
      }),
    });

    const result = assertOk(await runner.reconcileAccounts([account], STORED_RECONCILE_OPTIONS));

    expect(result.status).toBe('partial');
    expect(result.summary.categoryUnsupported).toBe(1);
    expect(result.scopes[0]?.rows[0]).toMatchObject({
      assetSymbol: 'ATOM',
      balanceCategory: 'staked',
      expectedQuantity: '25',
      referenceQuantity: '0',
      status: 'category_unsupported',
    });
    expect(result.scopes[0]?.rows[0]?.referenceUnavailableReason).toContain(
      'Stored balance snapshot contains no usable live reference balances'
    );
  });

  it('uses category-aware live reference rows when a future provider supplies them', async () => {
    const account = createAccount({ id: 1, name: 'cosmos-main', platformKey: 'cosmos' });
    const assetId = 'cosmos:cosmoshub-4/slip44:118';
    const balanceWorkflow = {
      refreshVerification: vi.fn(async () =>
        ok({
          account,
          mode: 'verification',
          timestamp: new Date('2026-04-26T03:00:00.000Z').getTime(),
          status: 'success',
          comparisons: [
            {
              assetId,
              assetSymbol: 'ATOM',
              balanceCategory: 'staked',
              calculatedBalance: '0',
              liveBalance: '25',
              difference: '-25',
              percentageDiff: 100,
              status: 'mismatch',
            },
          ],
          coverage: {
            status: 'complete',
            confidence: 'high',
            requestedAddresses: 1,
            successfulAddresses: 1,
            failedAddresses: 0,
            totalAssets: 1,
            parsedAssets: 1,
            failedAssets: 0,
            overallCoverageRatio: 1,
          },
          summary: {
            matches: 0,
            mismatches: 1,
            totalBalanceRows: 1,
            warnings: 0,
          },
        })
      ),
    };
    const runner = new AccountsReconcileRunner({
      balanceWorkflow: balanceWorkflow as never,
      db: createDataSessionMock({
        accounts: [account],
        postingsByAccountId: new Map([
          [
            1,
            [
              createLedgerPosting({
                ownerAccountId: 1,
                assetId,
                assetSymbol: 'ATOM',
                balanceCategory: 'staked',
                quantity: '25',
              }),
            ],
          ],
        ]),
      }),
    });

    const result = assertOk(await runner.reconcileAccounts([account], LIVE_RECONCILE_OPTIONS));

    expect(result.status).toBe('matched');
    expect(result.summary.categoryUnsupported).toBe(0);
    expect(result.scopes[0]?.rows[0]).toMatchObject({
      assetSymbol: 'ATOM',
      balanceCategory: 'staked',
      expectedQuantity: '25',
      referenceQuantity: '25',
      referenceRefs: [`live:1:${assetId}:staked`],
      status: 'matched',
    });
  });

  it('marks scopes without persisted ledger postings as unavailable', async () => {
    const account = createAccount({ id: 1, name: 'wallet-main' });
    const runner = new AccountsReconcileRunner({
      db: createDataSessionMock({
        accounts: [account],
        postingsByAccountId: new Map([[1, []]]),
      }),
    });

    const result = assertOk(await runner.reconcileAccounts([account], STORED_RECONCILE_OPTIONS));

    expect(result.status).toBe('unavailable');
    expect(result.summary.unavailableScopes).toBe(1);
    expect(result.scopes[0]).toMatchObject({
      status: 'unavailable',
      rows: [],
      diagnostics: {
        reason: 'No persisted ledger postings exist for this account scope.',
      },
    });
  });
});
