import type { ProjectionStatus } from '@exitbook/core';

interface BalanceSnapshotFreshnessMessageParams {
  requestedAccountId: number;
  scopeAccountId: number;
  scopeSourceName: string;
  status: ProjectionStatus;
  reason?: string | undefined;
}

interface AssetsFreshnessMessageParams {
  scopeAccountId: number;
  status: ProjectionStatus;
  reason?: string | undefined;
}

interface BalanceFreshnessDescription {
  affectsAllScopes: boolean;
  text: string;
}

function describeBalanceFreshness(params: {
  reason?: string | undefined;
  status: ProjectionStatus;
}): BalanceFreshnessDescription {
  switch (params.reason) {
    case 'upstream-rebuilt:processed-transactions':
      return {
        affectsAllScopes: true,
        text: 'processed transactions were rebuilt, which invalidated stored balance snapshots for all scopes',
      };
    case 'upstream-reset:processed-transactions':
      return {
        affectsAllScopes: true,
        text: 'processed transactions were reset, which invalidated stored balance snapshots for all scopes',
      };
    case 'upstream-import:processed-transactions':
      return {
        affectsAllScopes: false,
        text: 'processed transactions changed after a new import',
      };
    default:
      return {
        affectsAllScopes: false,
        text: params.reason ?? `balance projection is ${params.status}`,
      };
  }
}

export function formatBalanceSnapshotFreshnessMessage(params: BalanceSnapshotFreshnessMessageParams): string {
  const description = describeBalanceFreshness({ reason: params.reason, status: params.status });
  const requestedScopeHint =
    params.requestedAccountId === params.scopeAccountId
      ? `--account-id ${params.scopeAccountId}`
      : `--account-id ${params.requestedAccountId}`;

  if (description.affectsAllScopes) {
    return (
      `Stored balance snapshot for scope account #${params.scopeAccountId} (${params.scopeSourceName}) ` +
      `is ${params.status} because ${description.text}. ` +
      `Run "exitbook balance refresh" to rebuild all stored balances, or ` +
      `"exitbook balance refresh ${requestedScopeHint}" to rebuild only the requested scope.`
    );
  }

  return (
    `Stored balance snapshot for scope account #${params.scopeAccountId} (${params.scopeSourceName}) ` +
    `is ${params.status} because ${description.text}. ` +
    `Run "exitbook balance refresh ${requestedScopeHint}" to rebuild it.`
  );
}

export function formatAssetsFreshnessMessage(params: AssetsFreshnessMessageParams): string {
  const description = describeBalanceFreshness({ reason: params.reason, status: params.status });

  if (description.affectsAllScopes) {
    return (
      `Assets view requires fresh balance snapshots. Scope account #${params.scopeAccountId} ` +
      `is ${params.status} because ${description.text}. ` +
      `Run "exitbook balance refresh" to rebuild all stored balances, or ` +
      `"exitbook balance refresh --account-id ${params.scopeAccountId}" to rebuild only this scope.`
    );
  }

  return (
    `Assets view requires fresh balance snapshots. Scope account #${params.scopeAccountId} ` +
    `is ${params.status} because ${description.text}. ` +
    `Run "exitbook balance refresh --account-id ${params.scopeAccountId}" or "exitbook balance refresh" ` +
    'to rebuild stored balances.'
  );
}
