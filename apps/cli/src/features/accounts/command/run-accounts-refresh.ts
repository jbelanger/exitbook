import type { Result } from '@exitbook/foundation';

import type { EventRelay } from '../../../ui/shared/event-relay.js';

import type { AccountsRefreshScope } from './accounts-refresh-scope.js';
import type {
  AccountsRefreshEvent,
  AllAccountsRefreshResult,
  SingleRefreshResult,
  SortedRefreshAccount,
} from './accounts-refresh-types.js';

export async function runAccountsRefreshSingle(
  scope: AccountsRefreshScope,
  params: {
    accountId: number;
  }
): Promise<Result<SingleRefreshResult, Error>> {
  return scope.refreshRunner.refreshSingleScope({
    accountId: params.accountId,
    profileId: scope.profile.id,
  });
}

export async function runAccountsRefreshAll(
  scope: AccountsRefreshScope
): Promise<Result<AllAccountsRefreshResult, Error>> {
  return scope.refreshRunner.refreshAllScopes(scope.profile.id);
}

export async function loadAccountsRefreshTargets(
  scope: AccountsRefreshScope
): Promise<Result<SortedRefreshAccount[], Error>> {
  return scope.refreshRunner.loadAccountsForRefresh(scope.profile.id);
}

export function startAccountsRefreshStream(
  scope: AccountsRefreshScope,
  accounts: SortedRefreshAccount[],
  relay: EventRelay<AccountsRefreshEvent>
): void {
  scope.refreshRunner.startStream(accounts, relay);
}

export async function awaitAccountsRefreshStream(scope: AccountsRefreshScope): Promise<void> {
  await scope.refreshRunner.awaitStream();
}

export function abortAccountsRefresh(scope: AccountsRefreshScope): void {
  scope.refreshRunner.abort();
}
