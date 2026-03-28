import type { ExchangeCredentials } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';

import type { EventRelay } from '../../../ui/shared/event-relay.js';
import type { BalanceEvent } from '../view/balance-view-state.js';

import type { BalanceCommandScope } from './balance-command-scope.js';
import type {
  AllAccountsVerificationResult,
  SingleRefreshResult,
  SortedVerificationAccount,
  StoredSnapshotBalanceResult,
} from './balance-handler-types.js';

export async function runBalanceView(
  scope: BalanceCommandScope,
  params: {
    accountId?: number | undefined;
  }
): Promise<Result<StoredSnapshotBalanceResult, Error>> {
  return scope.snapshotReader.viewStoredSnapshots({
    accountId: params.accountId,
    profileId: scope.profile.id,
  });
}

export async function runBalanceRefreshSingle(
  scope: BalanceCommandScope,
  params: {
    accountId: number;
    credentials?: ExchangeCredentials | undefined;
  }
): Promise<Result<SingleRefreshResult, Error>> {
  return scope.verificationRunner.refreshSingleScope({
    accountId: params.accountId,
    credentials: params.credentials,
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

export function abortBalanceVerification(scope: BalanceCommandScope): void {
  scope.verificationRunner.abort();
}
