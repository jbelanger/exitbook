import { buildLedgerBalancesFromPostings, type LedgerBalancePostingInput } from '@exitbook/accounting/ledger-balance';
import type { Account, BalanceSnapshot, BalanceSnapshotAsset } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, type Result } from '@exitbook/foundation';
import {
  reconcileBalanceRows,
  type BalanceWorkflow,
  type BalanceVerificationResult,
  type BalanceReconciliationInputRow,
  type BalanceReconciliationUnsupportedReferenceRow,
} from '@exitbook/ingestion/balance';
import { loadAccountScopeContext } from '@exitbook/ingestion/ports';

import { formatAccountSelectorLabel } from '../account-selector.js';

import type {
  AccountsReconcileAccountSummary,
  AccountsReconcileOptions,
  AccountsReconcileResult,
  AccountsReconcileScopeResult,
  AccountsReconcileStatus,
} from './accounts-reconcile-types.js';
import { resolveAccountRefreshCredentials } from './accounts-refresh-utils.js';

export const DEFAULT_ACCOUNTS_RECONCILE_TOLERANCE = '0.00000001';

interface AccountsReconcileRunnerDeps {
  balanceWorkflow?: BalanceWorkflow | undefined;
  db: DataSession;
}

interface LedgerExpectedRows {
  diagnostics: {
    journalRefs: number;
    postingRefs: number;
    sourceActivityRefs: number;
  };
  rows: BalanceReconciliationInputRow[];
}

interface ReferenceRows {
  calculatedAt?: Date | undefined;
  lastRefreshAt?: Date | undefined;
  reason?: string | undefined;
  rows: BalanceReconciliationInputRow[];
  unsupportedRows: BalanceReconciliationUnsupportedReferenceRow[];
}

export class AccountsReconcileRunner {
  constructor(private readonly deps: AccountsReconcileRunnerDeps) {}

  async reconcileAccounts(
    requestedAccounts: readonly Account[],
    options: AccountsReconcileOptions
  ): Promise<Result<AccountsReconcileResult, Error>> {
    const scopes: AccountsReconcileScopeResult[] = [];
    const refreshedLive = options.referenceSource === 'live';

    for (const requestedAccount of requestedAccounts) {
      const scopeResult = await this.reconcileAccount(requestedAccount, options);
      if (scopeResult.isErr()) {
        scopes.push(this.buildErrorScope(requestedAccount, scopeResult.error.message, options));
        continue;
      }

      scopes.push(scopeResult.value);
    }

    return ok({
      referenceSource: options.referenceSource,
      refreshedLive,
      scopes,
      status: summarizeOverallStatus(scopes),
      summary: summarizeScopes(scopes),
      tolerance: options.tolerance ?? DEFAULT_ACCOUNTS_RECONCILE_TOLERANCE,
    });
  }

  async reconcileAccount(
    requestedAccount: Account,
    options: AccountsReconcileOptions
  ): Promise<Result<AccountsReconcileScopeResult, Error>> {
    const scopeContextResult = await loadAccountScopeContext(requestedAccount, {
      findById: (id) => this.deps.db.accounts.findById(id),
      findChildAccounts: (parentAccountId) =>
        this.deps.db.accounts.findAll({ parentAccountId, profileId: requestedAccount.profileId }),
    });
    if (scopeContextResult.isErr()) {
      return err(scopeContextResult.error);
    }

    const { requestedAccount: selectedAccount, scopeAccount } = scopeContextResult.value;
    const expectedRowsResult = await this.loadExpectedRows(scopeAccount);
    if (expectedRowsResult.isErr()) {
      return err(expectedRowsResult.error);
    }

    if (expectedRowsResult.value.rows.length === 0) {
      return ok(
        this.buildUnavailableScope({
          diagnostics: expectedRowsResult.value.diagnostics,
          options,
          reason: 'No persisted ledger postings exist for this account scope.',
          requestedAccount: selectedAccount,
          scopeAccount,
        })
      );
    }

    const referenceRowsResult =
      options.referenceSource === 'live'
        ? await this.loadLiveReferenceRows(selectedAccount, scopeAccount, expectedRowsResult.value.rows)
        : await this.loadStoredReferenceRows(scopeAccount, expectedRowsResult.value.rows);
    if (referenceRowsResult.isErr()) {
      return ok(
        this.buildUnavailableScope({
          diagnostics: expectedRowsResult.value.diagnostics,
          options,
          reason: referenceRowsResult.error.message,
          requestedAccount: selectedAccount,
          scopeAccount,
        })
      );
    }

    const reconciliationResult = reconcileBalanceRows({
      expectedRows: expectedRowsResult.value.rows,
      referenceRows: referenceRowsResult.value.rows,
      referenceSource: options.referenceSource,
      tolerance: options.tolerance,
      unsupportedReferenceRows: referenceRowsResult.value.unsupportedRows,
    });
    if (reconciliationResult.isErr()) {
      return err(reconciliationResult.error);
    }

    const summary = reconciliationResult.value.summary;
    return ok({
      account: toAccountSummary(scopeAccount),
      ...(selectedAccount.id !== scopeAccount.id && { requestedAccount: toAccountSummary(selectedAccount) }),
      rows: reconciliationResult.value.rows,
      status: getScopeStatus(summary),
      summary,
      diagnostics: {
        calculatedAt: referenceRowsResult.value.calculatedAt?.toISOString(),
        lastRefreshAt: referenceRowsResult.value.lastRefreshAt?.toISOString(),
        reason: referenceRowsResult.value.reason,
        referenceSource: options.referenceSource,
        ...expectedRowsResult.value.diagnostics,
      },
    });
  }

  private async loadExpectedRows(scopeAccount: Account): Promise<Result<LedgerExpectedRows, Error>> {
    const postingsResult = await this.deps.db.accountingLedger.findPostingsByOwnerAccountId(scopeAccount.id);
    if (postingsResult.isErr()) {
      return err(
        new Error(
          `Failed to load ledger postings for ${formatAccountSelectorLabel(scopeAccount)}: ${postingsResult.error.message}`
        )
      );
    }

    const ledgerResult = buildLedgerBalancesFromPostings(
      postingsResult.value.map(
        (posting): LedgerBalancePostingInput => ({
          ownerAccountId: posting.ownerAccountId,
          assetId: posting.assetId,
          assetSymbol: posting.assetSymbol,
          balanceCategory: posting.balanceCategory,
          quantity: posting.quantity,
          journalFingerprint: posting.journalFingerprint,
          postingFingerprint: posting.postingFingerprint,
          sourceActivityFingerprint: posting.sourceActivityFingerprint,
        })
      )
    );
    if (ledgerResult.isErr()) {
      return err(ledgerResult.error);
    }

    return ok({
      diagnostics: {
        journalRefs: ledgerResult.value.summary.journalCount,
        postingRefs: ledgerResult.value.summary.postingCount,
        sourceActivityRefs: ledgerResult.value.summary.sourceActivityCount,
      },
      rows: ledgerResult.value.balances.map((balance) => ({
        accountId: balance.ownerAccountId,
        assetId: balance.assetId,
        assetSymbol: balance.assetSymbol,
        balanceCategory: balance.balanceCategory,
        quantity: balance.quantity.toFixed(),
        refs: balance.postingFingerprints,
      })),
    });
  }

  private async loadStoredReferenceRows(
    scopeAccount: Account,
    expectedRows: readonly BalanceReconciliationInputRow[]
  ): Promise<Result<ReferenceRows, Error>> {
    const snapshotResult = await this.deps.db.balanceSnapshots.findSnapshot(scopeAccount.id);
    if (snapshotResult.isErr()) {
      return err(new Error(`Failed to load stored balance snapshot: ${snapshotResult.error.message}`));
    }

    const snapshot = snapshotResult.value;
    const assetsResult = await this.deps.db.balanceSnapshots.findAssetsByScope([scopeAccount.id]);
    if (assetsResult.isErr()) {
      return err(new Error(`Failed to load stored balance snapshot assets: ${assetsResult.error.message}`));
    }

    const usableLiveAssets = assetsResult.value.filter(
      (asset) => asset.liveBalance !== undefined && !asset.excludedFromAccounting
    );
    const reason = getStoredReferenceUnavailableReason(snapshot, usableLiveAssets);
    const unsupportedRows = buildUnsupportedReferenceRows({
      expectedRows,
      reason:
        reason ??
        'Selected reference source stores liquid live balances only; this balance category is not represented yet.',
      supportsLiquid: reason === undefined,
    });

    return ok({
      calculatedAt: snapshot?.calculatedAt,
      lastRefreshAt: snapshot?.lastRefreshAt,
      reason,
      rows: usableLiveAssets.map((asset) => toStoredReferenceRow(scopeAccount.id, asset)),
      unsupportedRows,
    });
  }

  private async loadLiveReferenceRows(
    requestedAccount: Account,
    scopeAccount: Account,
    expectedRows: readonly BalanceReconciliationInputRow[]
  ): Promise<Result<ReferenceRows, Error>> {
    if (!this.deps.balanceWorkflow) {
      return err(new Error('Live reconciliation requires a balance workflow'));
    }

    const credentialsResult = resolveAccountRefreshCredentials(requestedAccount);
    if (credentialsResult.skipReason) {
      return err(
        new Error(
          `Live reconciliation for ${formatAccountSelectorLabel(requestedAccount)} is unavailable: ${credentialsResult.skipReason}.`
        )
      );
    }

    const verificationResult = await this.deps.balanceWorkflow.refreshVerification({
      accountId: requestedAccount.id,
      credentials: credentialsResult.credentials,
    });
    if (verificationResult.isErr()) {
      return err(new Error(`Live balance refresh failed: ${verificationResult.error.message}`));
    }

    const verification = verificationResult.value;
    const reason = getLiveReferenceUnavailableReason(verification);
    const unsupportedRows = buildUnsupportedReferenceRows({
      expectedRows,
      reason:
        reason ??
        'Selected reference source exposes liquid live balances only; this balance category is not represented yet.',
      supportsLiquid: reason === undefined,
    });

    return ok({
      calculatedAt: new Date(verification.timestamp),
      lastRefreshAt: verification.mode === 'verification' ? new Date(verification.timestamp) : undefined,
      reason,
      rows:
        verification.mode === 'verification'
          ? verification.comparisons.map((comparison) => ({
              accountId: scopeAccount.id,
              assetId: comparison.assetId,
              assetSymbol: comparison.assetSymbol,
              balanceCategory: 'liquid',
              quantity: comparison.liveBalance,
              refs: [`live:${scopeAccount.id}:${comparison.assetId}`],
            }))
          : [],
      unsupportedRows,
    });
  }

  private buildUnavailableScope(params: {
    diagnostics: LedgerExpectedRows['diagnostics'];
    options: AccountsReconcileOptions;
    reason: string;
    requestedAccount: Account;
    scopeAccount: Account;
  }): AccountsReconcileScopeResult {
    return {
      account: toAccountSummary(params.scopeAccount),
      ...(params.requestedAccount.id !== params.scopeAccount.id && {
        requestedAccount: toAccountSummary(params.requestedAccount),
      }),
      rows: [],
      status: 'unavailable',
      summary: emptyReconciliationSummary(),
      diagnostics: {
        reason: params.reason,
        referenceSource: params.options.referenceSource,
        ...params.diagnostics,
      },
    };
  }

  private buildErrorScope(
    requestedAccount: Account,
    reason: string,
    options: AccountsReconcileOptions
  ): AccountsReconcileScopeResult {
    return {
      account: toAccountSummary(requestedAccount),
      rows: [],
      status: 'error',
      summary: emptyReconciliationSummary(),
      diagnostics: {
        reason,
        referenceSource: options.referenceSource,
        journalRefs: 0,
        postingRefs: 0,
        sourceActivityRefs: 0,
      },
    };
  }
}

function toStoredReferenceRow(scopeAccountId: number, asset: BalanceSnapshotAsset): BalanceReconciliationInputRow {
  return {
    accountId: scopeAccountId,
    assetId: asset.assetId,
    assetSymbol: asset.assetSymbol,
    balanceCategory: 'liquid',
    quantity: asset.liveBalance ?? '0',
    refs: [`balance-snapshot:${scopeAccountId}:${asset.assetId}:live`],
  };
}

function getStoredReferenceUnavailableReason(
  snapshot: BalanceSnapshot | undefined,
  usableLiveAssets: readonly BalanceSnapshotAsset[]
): string | undefined {
  if (!snapshot) {
    return 'Stored balance snapshot has never been built.';
  }

  if (snapshot.verificationStatus === 'never-run' || snapshot.verificationStatus === 'unavailable') {
    return snapshot.statusReason ?? 'Stored balance snapshot has no live reference balances.';
  }

  if (usableLiveAssets.length === 0) {
    return 'Stored balance snapshot contains no usable live reference balances.';
  }

  return undefined;
}

function getLiveReferenceUnavailableReason(verification: BalanceVerificationResult): string | undefined {
  if (verification.mode === 'calculated-only') {
    return verification.warnings?.[0] ?? verification.suggestion ?? 'Live balance reference is unavailable.';
  }

  return undefined;
}

function buildUnsupportedReferenceRows(params: {
  expectedRows: readonly BalanceReconciliationInputRow[];
  reason: string;
  supportsLiquid: boolean;
}): BalanceReconciliationUnsupportedReferenceRow[] {
  return params.expectedRows
    .filter((row) => !params.supportsLiquid || row.balanceCategory !== 'liquid')
    .map((row) => ({
      accountId: row.accountId,
      assetId: row.assetId,
      assetSymbol: row.assetSymbol,
      balanceCategory: row.balanceCategory,
      reason: params.reason,
    }));
}

function getScopeStatus(summary: AccountsReconcileScopeResult['summary']): AccountsReconcileStatus {
  if (summary.quantityMismatches > 0 || summary.missingReference > 0 || summary.unexpectedReference > 0) {
    return 'issues';
  }

  if (summary.categoryUnsupported > 0) {
    return 'partial';
  }

  return 'matched';
}

function summarizeScopes(scopes: readonly AccountsReconcileScopeResult[]): AccountsReconcileResult['summary'] {
  return {
    categoryUnsupported: scopes.reduce((total, scope) => total + scope.summary.categoryUnsupported, 0),
    errors: scopes.filter((scope) => scope.status === 'error').length,
    issueScopes: scopes.filter((scope) => scope.status === 'issues').length,
    matched: scopes.reduce((total, scope) => total + scope.summary.matched, 0),
    matchedScopes: scopes.filter((scope) => scope.status === 'matched').length,
    missingReference: scopes.reduce((total, scope) => total + scope.summary.missingReference, 0),
    partialScopes: scopes.filter((scope) => scope.status === 'partial').length,
    quantityMismatches: scopes.reduce((total, scope) => total + scope.summary.quantityMismatches, 0),
    totalRows: scopes.reduce((total, scope) => total + scope.summary.totalRows, 0),
    totalScopes: scopes.length,
    unavailableScopes: scopes.filter((scope) => scope.status === 'unavailable').length,
    unexpectedReference: scopes.reduce((total, scope) => total + scope.summary.unexpectedReference, 0),
  };
}

function summarizeOverallStatus(scopes: readonly AccountsReconcileScopeResult[]): AccountsReconcileStatus {
  const summary = summarizeScopes(scopes);
  if (summary.errors > 0) return 'error';
  if (summary.issueScopes > 0) return 'issues';
  if (summary.partialScopes > 0) return 'partial';
  if (summary.unavailableScopes > 0) {
    return summary.unavailableScopes === summary.totalScopes ? 'unavailable' : 'partial';
  }
  return 'matched';
}

function emptyReconciliationSummary(): AccountsReconcileScopeResult['summary'] {
  return {
    categoryUnsupported: 0,
    matched: 0,
    missingReference: 0,
    quantityMismatches: 0,
    totalRows: 0,
    unexpectedReference: 0,
  };
}

function toAccountSummary(account: Account): AccountsReconcileAccountSummary {
  return {
    id: account.id,
    accountFingerprint: account.accountFingerprint,
    identifier: account.identifier,
    name: account.name,
    platformKey: account.platformKey,
    type: account.accountType,
  };
}
