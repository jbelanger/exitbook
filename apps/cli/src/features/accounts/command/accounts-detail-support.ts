import type { AccountLifecycleService } from '@exitbook/accounts';
import type { Account } from '@exitbook/core';
import { buildBalancesFreshnessPorts } from '@exitbook/data/balances';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import { resolveBalanceScopeAccountId } from '@exitbook/ingestion/ports';

import { BalanceAssetDetailsBuilder } from '../../balance/command/balance-asset-details-builder.js';
import { sortStoredSnapshotAssets } from '../../balance/view/balance-view-utils.js';
import {
  buildBalanceSnapshotUnreadableDetail,
  BALANCE_SNAPSHOT_NEVER_BUILT_REASON,
} from '../../shared/balance-snapshot-freshness-message.js';
import { formatAccountFingerprintRef } from '../account-selector.js';
import type { AccountDetailViewItem, AccountScopeViewItem, AccountViewItem } from '../accounts-view-model.js';
import { maskIdentifier } from '../query/account-query-utils.js';

interface BuildAccountDetailViewItemParams {
  accountId: number;
  accountService: AccountLifecycleService;
  database: DataSession;
  profileId: number;
  summary: AccountViewItem;
}

export async function buildAccountDetailViewItem(
  params: BuildAccountDetailViewItemParams
): Promise<Result<AccountDetailViewItem, Error>> {
  return resultDoAsync(async function* () {
    const requestedAccount = yield* await requireOwnedAccount(
      params.accountService,
      params.accountId,
      params.profileId
    );
    const scopeAccount = yield* await resolveOwnedScopeAccount(
      params.accountService,
      requestedAccount,
      params.profileId
    );
    const requestedAccountView = toRequestedAccountViewItem(requestedAccount, scopeAccount);
    const scopeAccountView = toAccountScopeViewItem(scopeAccount);

    const freshnessResult = yield* await buildBalancesFreshnessPorts(params.database).checkFreshness(scopeAccount.id);

    if (freshnessResult.status !== 'fresh') {
      return buildUnreadableAccountDetailViewItem(params.summary, requestedAccountView, scopeAccountView, {
        reason: freshnessResult.reason ?? `projection is ${freshnessResult.status}`,
        status: freshnessResult.status,
      });
    }

    const snapshotResult = await params.database.balanceSnapshots.findSnapshot(scopeAccount.id);
    if (snapshotResult.isErr()) {
      return yield* err(snapshotResult.error);
    }

    const snapshot = snapshotResult.value;
    if (!snapshot) {
      return buildUnreadableAccountDetailViewItem(params.summary, requestedAccountView, scopeAccountView, {
        reason: BALANCE_SNAPSHOT_NEVER_BUILT_REASON,
        status: 'stale',
      });
    }

    const assetsResult = await new BalanceAssetDetailsBuilder(params.database).buildStoredSnapshotAssets(scopeAccount);
    if (assetsResult.isErr()) {
      return yield* err(assetsResult.error);
    }

    return {
      ...params.summary,
      requestedAccount: requestedAccountView,
      balance: {
        readable: true,
        scopeAccount: scopeAccountView,
        verificationStatus: snapshot.verificationStatus,
        statusReason: snapshot.statusReason,
        suggestion: snapshot.suggestion,
        lastRefreshAt: snapshot.lastRefreshAt?.toISOString(),
        assets: sortStoredSnapshotAssets(assetsResult.value),
      },
    };
  });
}

function buildUnreadableAccountDetailViewItem(
  summary: AccountViewItem,
  requestedAccount: AccountScopeViewItem | undefined,
  scopeAccount: AccountScopeViewItem,
  freshness: {
    reason: string;
    status: 'building' | 'failed' | 'stale';
  }
): AccountDetailViewItem {
  const unreadable = buildBalanceSnapshotUnreadableDetail({
    requestedAccountRef: formatAccountFingerprintRef(
      requestedAccount?.accountFingerprint ?? scopeAccount.accountFingerprint
    ),
    scopeAccountRef: formatAccountFingerprintRef(scopeAccount.accountFingerprint),
    scopeSourceName: scopeAccount.name ?? scopeAccount.identifier,
    status: freshness.status,
    reason: freshness.reason,
  });

  return {
    ...summary,
    requestedAccount,
    balance: {
      readable: false,
      scopeAccount,
      reason: unreadable.reason,
      hint: unreadable.hint,
    },
  };
}

async function requireOwnedAccount(
  accountService: AccountLifecycleService,
  accountId: number,
  profileId: number
): Promise<Result<Account, Error>> {
  const accountResult = await accountService.findById(accountId);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }

  const account = accountResult.value;
  if (!account || account.profileId !== profileId) {
    return err(new Error(`Account ${accountId} not found in the selected profile`));
  }

  return ok(account);
}

async function resolveOwnedScopeAccount(
  accountService: AccountLifecycleService,
  requestedAccount: Account,
  profileId: number
): Promise<Result<Account, Error>> {
  const scopeAccountIdResult = await resolveBalanceScopeAccountId(requestedAccount, {
    findById: (accountId: number) => accountService.findById(accountId),
  });
  if (scopeAccountIdResult.isErr()) {
    return err(scopeAccountIdResult.error);
  }

  if (scopeAccountIdResult.value === requestedAccount.id) {
    return ok(requestedAccount);
  }

  return requireOwnedAccount(accountService, scopeAccountIdResult.value, profileId);
}

function toAccountScopeViewItem(account: Account): AccountScopeViewItem {
  return {
    id: account.id,
    accountFingerprint: account.accountFingerprint,
    accountType: account.accountType,
    platformKey: account.platformKey,
    identifier: maskIdentifier(account),
    name: account.name,
  };
}

function toRequestedAccountViewItem(
  requestedAccount: Account,
  scopeAccount: Account
): AccountScopeViewItem | undefined {
  if (requestedAccount.id === scopeAccount.id) {
    return undefined;
  }

  return toAccountScopeViewItem(requestedAccount);
}
