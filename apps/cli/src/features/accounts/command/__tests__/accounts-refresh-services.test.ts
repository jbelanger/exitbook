import type { Account, BalanceSnapshotAsset } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { EventRelay } from '../../../../ui/shared/event-relay.js';
import { AccountBalanceDetailBuilder } from '../account-balance-detail-builder.js';
import { AccountsRefreshRunner } from '../accounts-refresh-runner.js';
import type { AccountsRefreshEvent } from '../accounts-refresh-types.js';

function createAccount(overrides: Partial<Account> = {}): Account {
  const profileId = overrides.profileId ?? 1;
  const accountType = overrides.accountType ?? 'blockchain';
  const platformKey = overrides.platformKey ?? 'bitcoin';
  const identifier = overrides.identifier ?? `identifier-${overrides.id ?? 1}`;

  return {
    id: overrides.id ?? 1,
    profileId,
    name: overrides.name,
    accountType,
    platformKey,
    identifier,
    accountFingerprint:
      overrides.accountFingerprint ?? `${(overrides.id ?? 1).toString(16)}${'a'.repeat(63)}`.slice(0, 64),
    parentAccountId: overrides.parentAccountId,
    providerName: overrides.providerName,
    credentials: overrides.credentials,
    lastCursor: overrides.lastCursor,
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt,
  };
}

function createMockDb(params: {
  accounts: Account[];
  childAccountError?: Error;
  snapshotAssetError?: Error;
  snapshotAssets: BalanceSnapshotAsset[];
  transactionError?: Error;
}) {
  const accountsById = new Map(params.accounts.map((account) => [account.id, account]));
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
      findAssetsByScope: vi.fn().mockImplementation(async (scopeAccountIds?: number[]) => {
        if (params.snapshotAssetError) {
          return err(params.snapshotAssetError);
        }

        return ok(
          scopeAccountIds
            ? params.snapshotAssets.filter((asset) => scopeAccountIds.includes(asset.scopeAccountId))
            : params.snapshotAssets
        );
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

function createRefreshServices(
  mockDb: ReturnType<typeof createMockDb> | Record<string, unknown>,
  balanceWorkflow: unknown,
  accountService: ReturnType<typeof createMockAccountService>
) {
  const detailBuilder = new AccountBalanceDetailBuilder(mockDb as unknown as DataSession);
  const ledgerBalanceShadowBuilder = {
    build: vi.fn().mockResolvedValue(
      ok({
        status: 'unavailable',
        reason: 'No persisted ledger postings exist for this account scope.',
        summary: {
          totalCurrencies: 0,
          liveMatches: 0,
          liveMismatches: 0,
          legacyMatches: 0,
          legacyDiffs: 0,
          sourceActivities: 0,
          journals: 0,
          postings: 0,
        },
        balances: [],
      })
    ),
  };

  return {
    refreshRunner: new AccountsRefreshRunner({
      accountService,
      detailBuilder,
      ledgerBalanceShadowBuilder: ledgerBalanceShadowBuilder as never,
      balanceWorkflow: balanceWorkflow as never,
    }),
  };
}

describe('AccountsRefreshRunner.refreshSingleScope', () => {
  it('fails fast when an exchange account has no stored provider credentials', async () => {
    const account = createAccount({
      id: 21,
      name: 'kucoin-csv',
      accountType: 'exchange-csv',
      platformKey: 'kucoin',
      identifier: 'exports/kucoin',
      credentials: undefined,
    });
    const mockDb = createMockDb({
      accounts: [account],
      snapshotAssets: [],
    });
    const balanceWorkflow = {
      refreshVerification: vi.fn(),
    };

    const { refreshRunner } = createRefreshServices(mockDb, balanceWorkflow, mockDb.accountService);
    const result = await refreshRunner.refreshSingleScope({ accountId: account.id, profileId: 1 });
    const error = assertErr(result);

    expect(error.message).toContain('kucoin-csv');
    expect(error.message).toContain('no stored provider credentials');
    expect(balanceWorkflow.refreshVerification).not.toHaveBeenCalled();
  });
});

describe('AccountBalanceDetailBuilder.buildStoredSnapshotAssets', () => {
  it('propagates stored snapshot asset repository failures instead of returning an empty list', async () => {
    const account = createAccount({ id: 13, identifier: 'bc1detail' });
    const mockDb = createMockDb({
      accounts: [account],
      snapshotAssetError: new Error('snapshot repository unavailable'),
      snapshotAssets: [],
    });
    const detailBuilder = new AccountBalanceDetailBuilder(mockDb as unknown as DataSession);

    const result = await detailBuilder.buildStoredSnapshotAssets(account);
    const error = assertErr(result);

    expect(error.message).toContain('Failed to load stored balance snapshot assets for account #13');
    expect(error.message).toContain('snapshot repository unavailable');
  });
});

describe('AccountsRefreshRunner.refreshAllScopes', () => {
  it('counts calculated-only warning results as verified totals', async () => {
    const account = createAccount({ id: 74, platformKey: 'lukso', identifier: '0xlukso' });
    const mockDb = createMockDb({
      accounts: [account],
      snapshotAssets: [],
    });
    const balanceWorkflow = {
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

    const { refreshRunner } = createRefreshServices(mockDb, balanceWorkflow, mockDb.accountService);
    const result = await refreshRunner.refreshAllScopes(1);
    const value = assertOk(result);

    expect(value.totals).toMatchObject({
      errors: 0,
      total: 1,
      verified: 1,
      skipped: 0,
      matches: 0,
      mismatches: 0,
      warnings: 1,
      partialCoverageScopes: 1,
    });
    expect(value.accounts[0]).toMatchObject({
      accountId: account.id,
      status: 'warning',
    });
  });
});

describe('AccountsRefreshRunner.startStream', () => {
  it('surfaces aborted streams and emits an abort event instead of completing successfully', async () => {
    let resolveVerification: ((value: unknown) => void) | undefined;
    const account = createAccount({ id: 31, identifier: 'bc1abort' });
    const mockDb = createMockDb({
      accounts: [account],
      snapshotAssets: [],
    });
    const balanceWorkflow = {
      refreshVerification: vi.fn().mockImplementation(
        async () =>
          await new Promise((resolve) => {
            resolveVerification = resolve;
          })
      ),
    };
    const { refreshRunner } = createRefreshServices(mockDb, balanceWorkflow, mockDb.accountService);
    const relay = new EventRelay<AccountsRefreshEvent>();
    const events: AccountsRefreshEvent[] = [];
    relay.connect((event) => {
      events.push(event);
    });

    refreshRunner.startStream(
      [
        {
          account,
          accountId: account.id,
          platformKey: account.platformKey,
          accountType: account.accountType,
          skipReason: undefined,
        },
      ],
      relay
    );

    refreshRunner.abort();
    resolveVerification?.(
      ok({
        account,
        mode: 'verification',
        timestamp: Date.now(),
        status: 'success',
        comparisons: [],
        coverage: {
          status: 'complete',
          confidence: 'high',
          requestedAddresses: 1,
          successfulAddresses: 1,
          failedAddresses: 0,
          totalAssets: 0,
          parsedAssets: 0,
          failedAssets: 0,
          overallCoverageRatio: 1,
        },
        summary: {
          matches: 0,
          mismatches: 0,
          warnings: 0,
          totalCurrencies: 0,
        },
        suggestion: 'Balances match',
        partialFailures: undefined,
        warnings: undefined,
      })
    );

    const status = await refreshRunner.awaitStream();

    expect(status).toBe('aborted');
    expect(events).toContainEqual({ type: 'ABORTING' });
    expect(events).not.toContainEqual({ type: 'ALL_VERIFICATIONS_COMPLETE' });
  });
});
