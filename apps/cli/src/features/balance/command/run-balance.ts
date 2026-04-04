import type { Result } from '@exitbook/foundation';

import type { EventRelay } from '../../../ui/shared/event-relay.js';
import type { BalanceEvent } from '../view/balance-view-state.js';

import type { BalanceCommandScope } from './balance-command-scope.js';
import type {
  AllAccountsVerificationResult,
  SingleRefreshResult,
  SortedVerificationAccount,
} from './balance-handler-types.js';

export async function runBalanceRefreshSingle(
  scope: BalanceCommandScope,
  params: {
    accountId: number;
  }
): Promise<Result<SingleRefreshResult, Error>> {
  return scope.verificationRunner.refreshSingleScope({
    accountId: params.accountId,
    profileId: scope.profile.id,
  });
}

export async function runBalanceRefreshAll(
  scope: BalanceCommandScope
): Promise<Result<AllAccountsVerificationResult, Error>> {
  return scope.verificationRunner.refreshAllScopes(scope.profile.id);
}

export async function loadBalanceVerificationAccounts(
  scope: BalanceCommandScope
): Promise<Result<SortedVerificationAccount[], Error>> {
  return scope.verificationRunner.loadAccountsForVerification(scope.profile.id);
}

export function startBalanceVerificationStream(
  scope: BalanceCommandScope,
  accounts: SortedVerificationAccount[],
  relay: EventRelay<BalanceEvent>
): void {
  scope.verificationRunner.startStream(accounts, relay);
}

export async function awaitBalanceVerificationStream(scope: BalanceCommandScope): Promise<void> {
  await scope.verificationRunner.awaitStream();
}

export function abortBalanceVerification(scope: BalanceCommandScope): void {
  scope.verificationRunner.abort();
}
