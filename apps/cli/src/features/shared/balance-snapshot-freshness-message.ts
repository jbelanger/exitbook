import type { ProjectionStatus } from '@exitbook/core';

export const BALANCE_SNAPSHOT_NEVER_BUILT_REASON = 'balance snapshot has never been built';
const ACCOUNTS_REFRESH_COMMAND = 'exitbook accounts refresh';

export type BalanceImportReadiness = 'missing-imports' | 'no-completed-imports' | 'ready';

interface BalanceSnapshotFreshnessMessageParams {
  importReadiness?: BalanceImportReadiness | undefined;
  requestedAccountRef: string;
  scopeAccountRef: string;
  scopeSourceName: string;
  status: ProjectionStatus;
  reason?: string | undefined;
}

interface AssetsFreshnessMessageParams {
  scopeAccountRef: string;
  status: ProjectionStatus;
  reason?: string | undefined;
}

interface BalanceFreshnessDescription {
  affectsAllScopes: boolean;
  text: string;
}

interface BalanceSnapshotUnreadableDetail {
  hint: string;
  reason: string;
  title: string;
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
  const detail = buildBalanceSnapshotUnreadableDetail(params);
  return [detail.title, detail.reason, `${capitalizeFirst(detail.hint)}.`].join(' ');
}

export function buildBalanceSnapshotUnreadableDetail(
  params: BalanceSnapshotFreshnessMessageParams
): BalanceSnapshotUnreadableDetail {
  const requestedScopeHint =
    params.requestedAccountRef === params.scopeAccountRef ? params.scopeAccountRef : params.requestedAccountRef;

  if (params.reason === BALANCE_SNAPSHOT_NEVER_BUILT_REASON) {
    if (params.importReadiness === 'missing-imports') {
      return {
        title: 'No balance data yet.',
        reason: 'This account has no imported transaction data yet.',
        hint: 'run "exitbook import" to import transaction data first',
      };
    }

    if (params.importReadiness === 'no-completed-imports') {
      return {
        title: 'No balance data yet.',
        reason: 'This account has import sessions, but none completed successfully yet.',
        hint: 'run "exitbook import" successfully before refreshing balances',
      };
    }

    return {
      title: 'No balance data yet.',
      reason: 'Balance data has not been calculated for this account yet.',
      hint: `run "${ACCOUNTS_REFRESH_COMMAND} ${requestedScopeHint}" to build it`,
    };
  }

  const description = describeDetailBalanceFreshness({ reason: params.reason, status: params.status });
  const title = getUnreadableBalanceTitle(params.status);
  if (description.affectsAllScopes) {
    return {
      title,
      reason: `${description.text}`,
      hint:
        `run "${ACCOUNTS_REFRESH_COMMAND}" to rebuild all stored balances, or ` +
        `"${ACCOUNTS_REFRESH_COMMAND} ${requestedScopeHint}" to rebuild only the requested scope`,
    };
  }

  return {
    title,
    reason: `${description.text}`,
    hint: `run "${ACCOUNTS_REFRESH_COMMAND} ${requestedScopeHint}" to rebuild it`,
  };
}

export function formatAssetsFreshnessMessage(params: AssetsFreshnessMessageParams): string {
  if (params.reason === BALANCE_SNAPSHOT_NEVER_BUILT_REASON) {
    return (
      `Assets view requires a stored balance snapshot. Scope account ${params.scopeAccountRef} ` +
      `has not been built yet. Run "${ACCOUNTS_REFRESH_COMMAND} ${params.scopeAccountRef}" or ` +
      `"${ACCOUNTS_REFRESH_COMMAND}" to build it.`
    );
  }

  const description = describeBalanceFreshness({ reason: params.reason, status: params.status });

  if (description.affectsAllScopes) {
    return (
      `Assets view requires fresh balance snapshots. Scope account ${params.scopeAccountRef} ` +
      `is ${params.status} because ${description.text}. ` +
      `Run "${ACCOUNTS_REFRESH_COMMAND}" to rebuild all stored balances, or ` +
      `"${ACCOUNTS_REFRESH_COMMAND} ${params.scopeAccountRef}" to rebuild only this scope.`
    );
  }

  return (
    `Assets view requires fresh balance snapshots. Scope account ${params.scopeAccountRef} ` +
    `is ${params.status} because ${description.text}. ` +
    `Run "${ACCOUNTS_REFRESH_COMMAND} ${params.scopeAccountRef}" or "${ACCOUNTS_REFRESH_COMMAND}" ` +
    'to rebuild stored balances.'
  );
}

function capitalizeFirst(value: string): string {
  return value.length > 0 ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function describeDetailBalanceFreshness(params: {
  reason?: string | undefined;
  status: ProjectionStatus;
}): BalanceFreshnessDescription {
  switch (params.reason) {
    case 'upstream-rebuilt:processed-transactions':
      return {
        affectsAllScopes: true,
        text: 'Processed transactions were rebuilt, so saved balances are out of date for every account.',
      };
    case 'upstream-reset:processed-transactions':
      return {
        affectsAllScopes: true,
        text: 'Processed transactions were reset, so saved balances are out of date for every account.',
      };
    case 'upstream-import:processed-transactions':
      return {
        affectsAllScopes: false,
        text: 'Processed transactions changed after a new import.',
      };
    default:
      return {
        affectsAllScopes: false,
        text: params.reason ?? `Saved balance data is ${params.status}.`,
      };
  }
}

function getUnreadableBalanceTitle(status: ProjectionStatus): string {
  switch (status) {
    case 'stale':
      return 'Balance data is out of date.';
    case 'building':
      return 'Balance data is being rebuilt.';
    case 'failed':
      return 'Balance data rebuild failed.';
    case 'fresh':
      return 'Balance data is available.';
  }
}
