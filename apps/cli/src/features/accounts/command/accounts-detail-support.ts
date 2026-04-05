import type { AccountLifecycleService } from '@exitbook/accounts';
import type { Account } from '@exitbook/core';
import { buildBalancesFreshnessPorts } from '@exitbook/data/balances';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';
import { loadBalanceScopeMemberAccounts, resolveBalanceScopeAccountId } from '@exitbook/ingestion/ports';

import {
  type BalanceImportReadiness,
  buildBalanceSnapshotUnreadableDetail,
  BALANCE_SNAPSHOT_NEVER_BUILT_REASON,
} from '../../shared/balance-snapshot-freshness-message.js';
import { sortStoredBalanceAssets } from '../../shared/stored-balance-detail-utils.js';
import { formatAccountFingerprintRef } from '../account-selector.js';
import type { AccountDetailViewItem, AccountScopeViewItem, AccountViewItem } from '../accounts-view-model.js';
import { maskIdentifier } from '../query/account-query-utils.js';

import { AccountBalanceDetailBuilder } from './account-balance-detail-builder.js';

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
      const importReadiness =
        freshnessResult.reason === BALANCE_SNAPSHOT_NEVER_BUILT_REASON
          ? yield* await loadBalanceImportReadiness(params.database, scopeAccount)
          : undefined;

      return buildUnreadableAccountDetailViewItem(params.summary, requestedAccountView, scopeAccountView, {
        reason: freshnessResult.reason ?? `projection is ${freshnessResult.status}`,
        status: freshnessResult.status,
        importReadiness,
      });
    }

    const snapshotResult = await params.database.balanceSnapshots.findSnapshot(scopeAccount.id);
    if (snapshotResult.isErr()) {
      return yield* err(snapshotResult.error);
    }

    const snapshot = snapshotResult.value;
    if (!snapshot) {
      const importReadiness = yield* await loadBalanceImportReadiness(params.database, scopeAccount);
      return buildUnreadableAccountDetailViewItem(params.summary, requestedAccountView, scopeAccountView, {
        reason: BALANCE_SNAPSHOT_NEVER_BUILT_REASON,
        status: 'stale',
        importReadiness,
      });
    }

    const assetsResult = await new AccountBalanceDetailBuilder(params.database).buildStoredSnapshotAssets(scopeAccount);
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
        assets: sortStoredBalanceAssets(assetsResult.value),
      },
    };
  });
}

function buildUnreadableAccountDetailViewItem(
  summary: AccountViewItem,
  requestedAccount: AccountScopeViewItem | undefined,
  scopeAccount: AccountScopeViewItem,
  freshness: {
    importReadiness?: BalanceImportReadiness | undefined;
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
    importReadiness: freshness.importReadiness,
  });

  return {
    ...summary,
    requestedAccount,
    balance: {
      readable: false,
      scopeAccount,
      reason: unreadable.reason ? `${unreadable.title} ${unreadable.reason}` : unreadable.title,
      hint: unreadable.hint,
    },
  };
}

async function loadBalanceImportReadiness(
  database: DataSession,
  scopeAccount: Account
): Promise<Result<BalanceImportReadiness, Error>> {
  const memberAccountsResult = await loadBalanceScopeMemberAccounts(scopeAccount, {
    findChildAccounts: async (parentAccountId: number) => {
      const childAccountsResult = await database.accounts.findAll({
        parentAccountId,
        profileId: scopeAccount.profileId,
      });
      if (childAccountsResult.isErr()) {
        return err(childAccountsResult.error);
      }

      return ok(childAccountsResult.value);
    },
  });
  if (memberAccountsResult.isErr()) {
    return err(
      new Error(
        `Failed to load descendant accounts for balance detail readiness for account #${scopeAccount.id}: ${memberAccountsResult.error.message}`
      )
    );
  }

  const sessionsResult = await database.importSessions.findAll({
    accountIds: memberAccountsResult.value.map((account) => account.id),
  });
  if (sessionsResult.isErr()) {
    return err(
      new Error(
        `Failed to load import sessions for balance detail readiness for account #${scopeAccount.id}: ${sessionsResult.error.message}`
      )
    );
  }

  if (sessionsResult.value.length === 0) {
    return ok('missing-imports');
  }

  if (!sessionsResult.value.some((session) => session.status === 'completed')) {
    return ok('no-completed-imports');
  }

  return ok('ready');
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
