import type { BalanceReconciliationRow } from '@exitbook/ingestion/balance';
import pc from 'picocolors';

import { formatAccountSelectorLabel } from '../account-selector.js';

import type { AccountsReconcileResult, AccountsReconcileScopeResult } from './accounts-reconcile-types.js';

interface LogAccountsReconcileOptions {
  includeMatchedRows: boolean;
}

export function logAccountsReconcileResult(
  result: AccountsReconcileResult,
  options: LogAccountsReconcileOptions
): void {
  console.log(pc.bold('Account reconciliation'));
  console.log(`Reference: ${result.referenceSource}${result.refreshedLive ? ' (refreshed)' : ''}`);
  console.log(`Tolerance: ${result.tolerance}`);
  console.log();

  for (const scope of result.scopes) {
    logScope(scope, options);
  }

  console.log(pc.bold('Summary'));
  console.log(
    [
      `${result.summary.totalScopes} scopes`,
      `${result.summary.totalRows} rows`,
      `${result.summary.matched} matched`,
      `${result.summary.quantityMismatches} mismatches`,
      `${result.summary.missingReference} missing reference`,
      `${result.summary.unexpectedReference} unexpected reference`,
      `${result.summary.categoryUnsupported} unsupported`,
      `${result.summary.unavailableScopes} unavailable`,
    ].join(' | ')
  );
}

function logScope(scope: AccountsReconcileScopeResult, options: LogAccountsReconcileOptions): void {
  const label = `${formatAccountSelectorLabel(scope.account)} (${scope.account.platformKey})`;
  const status = colorScopeStatus(scope.status, scope.status.toUpperCase());
  console.log(`${status} ${label}`);

  if (scope.requestedAccount) {
    console.log(
      pc.dim(
        `  requested ${formatAccountSelectorLabel(scope.requestedAccount)}; reconciled owner scope ${formatAccountSelectorLabel(scope.account)}`
      )
    );
  }

  if (scope.diagnostics.reason) {
    console.log(`  ${pc.dim(scope.diagnostics.reason)}`);
  }

  if (scope.status !== 'unavailable' && scope.status !== 'error') {
    console.log(
      pc.dim(
        `  ${scope.summary.totalRows} rows; ${scope.diagnostics.sourceActivityRefs} source activities, ${scope.diagnostics.journalRefs} journals, ${scope.diagnostics.postingRefs} postings`
      )
    );
  }

  const rows = filterRowsForText(scope.rows, options);
  for (const row of rows) {
    logRow(row);
  }

  if (rows.length === 0 && scope.rows.length > 0 && !options.includeMatchedRows) {
    console.log(pc.dim('  all comparable rows matched; use --all to show them'));
  }

  console.log();
}

function filterRowsForText(
  rows: readonly BalanceReconciliationRow[],
  options: LogAccountsReconcileOptions
): BalanceReconciliationRow[] {
  if (options.includeMatchedRows) {
    return [...rows];
  }

  return rows.filter((row) => row.status !== 'matched');
}

function logRow(row: BalanceReconciliationRow): void {
  const status = colorRowStatus(row.status, formatRowStatus(row.status));
  const diff = formatSignedQuantity(row.diffQuantity);
  const refs = row.expectedRefs.length > 0 ? `; ${row.expectedRefs.length} posting refs` : '';
  console.log(
    `  ${status} ${row.assetSymbol} ${pc.dim(row.balanceCategory)} expected ${row.expectedQuantity} reference ${row.referenceQuantity} diff ${diff}${refs}`
  );

  if (row.referenceUnavailableReason) {
    console.log(pc.dim(`    ${row.referenceUnavailableReason}`));
  }
}

function colorScopeStatus(status: AccountsReconcileScopeResult['status'], label: string): string {
  switch (status) {
    case 'matched':
      return pc.green(label);
    case 'partial':
      return pc.yellow(label);
    case 'issues':
      return pc.red(label);
    case 'unavailable':
    case 'error':
      return pc.gray(label);
  }
}

function colorRowStatus(status: BalanceReconciliationRow['status'], label: string): string {
  switch (status) {
    case 'matched':
      return pc.green(label);
    case 'category_unsupported':
      return pc.yellow(label);
    case 'missing_reference':
    case 'quantity_mismatch':
    case 'unexpected_reference':
      return pc.red(label);
  }
}

function formatRowStatus(status: BalanceReconciliationRow['status']): string {
  switch (status) {
    case 'category_unsupported':
      return 'unsupported';
    case 'matched':
      return 'matched';
    case 'missing_reference':
      return 'missing';
    case 'quantity_mismatch':
      return 'mismatch';
    case 'unexpected_reference':
      return 'unexpected';
  }
}

function formatSignedQuantity(quantity: string): string {
  if (quantity.startsWith('-') || quantity === '0') {
    return quantity;
  }

  return `+${quantity}`;
}
