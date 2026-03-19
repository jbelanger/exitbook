import type { Account, Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import { getDefaultRecommendedAction } from './tax-package-issue-recommendations.js';
import type { TaxPackageArtifactIndexEntry, TaxPackageFile, TaxPackageIssue } from './tax-package-types.js';

export interface TaxPackageIssueCsvRow {
  affected_artifact: string;
  affected_row_ref: string;
  code: string;
  details: string;
  issue_ref: string;
  recommended_action: string;
  severity: string;
  summary: string;
}

export interface TaxPackageSourceLinkRow {
  package_artifact: string;
  package_ref: string;
  source_account_label: string;
  source_type: string;
  source_url: string;
  source_venue_label: string;
  tx_fingerprint: string;
}

export function buildAccountLabeler(context: TaxPackageBuildContext): (accountId: number) => Result<string, Error> {
  const sourceNameCounts = countAccountsBySourceName(context);
  return (accountId: number) => {
    const account = context.sourceContext.accountsById.get(accountId);
    if (!account) {
      return err(new Error(`Missing account ${accountId} while rendering tax package`));
    }

    return ok(formatAccountLabel(account, sourceNameCounts.get(account.sourceName) ?? 0));
  };
}

export function countAccountsBySourceName(context: TaxPackageBuildContext): Map<string, number> {
  const counts = new Map<string, number>();
  for (const account of context.sourceContext.accountsById.values()) {
    counts.set(account.sourceName, (counts.get(account.sourceName) ?? 0) + 1);
  }
  return counts;
}

function formatAccountLabel(account: Account, sourceNameCount: number): string {
  if (sourceNameCount <= 1) {
    return account.sourceName;
  }

  return `${account.sourceName} (${account.identifier})`;
}

export function buildArtifactIndex(
  entries: readonly {
    logicalName: string;
    mediaType: string;
    purpose: string;
    relativePath: string;
    rowCount?: number | undefined;
  }[]
): TaxPackageArtifactIndexEntry[] {
  return entries.map((entry) => ({
    logicalName: entry.logicalName,
    relativePath: entry.relativePath,
    mediaType: entry.mediaType,
    purpose: entry.purpose,
    ...(entry.rowCount !== undefined ? { rowCount: entry.rowCount } : {}),
  }));
}

export function buildCsvFile(
  logicalName: string,
  relativePath: string,
  purpose: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): TaxPackageFile {
  return {
    logicalName,
    relativePath,
    mediaType: 'text/csv',
    purpose,
    content: renderCsv(headers, rows),
  };
}

export function countCsvRows(file: TaxPackageFile): number | undefined {
  if (file.mediaType !== 'text/csv') {
    return undefined;
  }

  return Math.max(0, file.content.trimEnd().split('\n').length - 1);
}

export function buildIssueRows(issues: readonly TaxPackageIssue[]): TaxPackageIssueCsvRow[] {
  const sorted = [...issues].sort((left, right) => {
    const severityDiff = severityRank(left.severity) - severityRank(right.severity);
    if (severityDiff !== 0) return severityDiff;
    const codeDiff = left.code.localeCompare(right.code);
    if (codeDiff !== 0) return codeDiff;
    const artifactDiff = (left.affectedArtifact ?? '').localeCompare(right.affectedArtifact ?? '');
    if (artifactDiff !== 0) return artifactDiff;
    return (left.affectedRowRef ?? '').localeCompare(right.affectedRowRef ?? '');
  });

  return sorted.map((issue, index) => ({
    issue_ref: makeRef('ISSUE', index + 1),
    code: issue.code,
    severity: issue.severity,
    summary: issue.summary,
    details: issue.details,
    affected_artifact: issue.affectedArtifact ?? '',
    affected_row_ref: issue.affectedRowRef ?? '',
    recommended_action: issue.recommendedAction ?? getDefaultRecommendedAction(issue.code),
  }));
}

export function appendSourceLinkRows(
  target: TaxPackageSourceLinkRow[],
  seen: Set<string>,
  params: {
    context: TaxPackageBuildContext;
    packageArtifact: string;
    packageRef: string;
    sourceNameCounts: Map<string, number>;
    transactionIds: readonly number[];
  }
): Result<void, Error> {
  for (const transactionId of params.transactionIds) {
    const transactionResult = requireTransaction(
      params.context,
      transactionId,
      `${params.packageArtifact}:${params.packageRef}`
    );
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }

    const account = params.context.sourceContext.accountsById.get(transactionResult.value.accountId);
    if (!account) {
      return err(
        new Error(`Missing account ${transactionResult.value.accountId} for transaction ${transactionResult.value.id}`)
      );
    }

    const row: TaxPackageSourceLinkRow = {
      package_ref: params.packageRef,
      package_artifact: params.packageArtifact,
      source_type: transactionResult.value.sourceType,
      source_venue_label: transactionResult.value.source,
      source_account_label: formatAccountLabel(account, params.sourceNameCounts.get(account.sourceName) ?? 0),
      tx_fingerprint: transactionResult.value.txFingerprint,
      source_url: '',
    };

    const dedupeKey = [
      row.package_ref,
      row.package_artifact,
      row.source_type,
      row.source_venue_label,
      row.source_account_label,
      row.tx_fingerprint,
    ].join('|');
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    target.push(row);
  }

  return ok(undefined);
}

export function requireTransaction(
  context: TaxPackageBuildContext,
  transactionId: number,
  reference: string
): Result<Transaction, Error> {
  const transaction = context.sourceContext.transactionsById.get(transactionId);
  if (!transaction) {
    return err(new Error(`Missing source transaction ${transactionId} for ${reference}`));
  }

  return ok(transaction);
}

export function resolveOptionalAccountLabel(
  context: TaxPackageBuildContext,
  transactionId: number | undefined,
  accountLabeler: (accountId: number) => Result<string, Error>
): Result<string, Error> {
  if (transactionId === undefined) {
    return ok('');
  }

  const transactionResult = requireTransaction(context, transactionId, `transaction ${transactionId}`);
  if (transactionResult.isErr()) {
    return err(transactionResult.error);
  }

  return accountLabeler(transactionResult.value.accountId);
}

export function makeRef(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(4, '0')}`;
}

export function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function formatMoney(value: Decimal): string {
  return value.toFixed(2);
}

export function formatOptionalMoney(value: Decimal): string {
  return value.isZero() ? '' : formatMoney(value);
}

/** Format an asset quantity (e.g. amount acquired, disposed, transferred). */
export function formatQuantity(value: Decimal): string {
  return trimTrailingZeros(value.toFixed());
}

/**
 * Format a per-unit measure (e.g. cost_basis_per_unit, acb_per_unit).
 * Currently identical to formatQuantity; kept separate so the two domains
 * can diverge independently (e.g. fixed-precision rounding for unit prices).
 */
export function formatMeasure(value: Decimal): string {
  return trimTrailingZeros(value.toFixed());
}

export function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) {
    return value;
  }

  return value.replace(/\.?0+$/, '');
}

function renderCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function severityRank(severity: string): number {
  return severity === 'blocked' ? 0 : 1;
}

export function buildSourceLinksCsvFile(rows: readonly TaxPackageSourceLinkRow[]): TaxPackageFile {
  return buildCsvFile(
    'source_links',
    'source-links.csv',
    'Audit traceability appendix linking package-local refs to source transaction fingerprints.',
    [
      'package_ref',
      'package_artifact',
      'source_type',
      'source_venue_label',
      'source_account_label',
      'tx_fingerprint',
      'source_url',
    ],
    rows.map((row) => [
      row.package_ref,
      row.package_artifact,
      row.source_type,
      row.source_venue_label,
      row.source_account_label,
      row.tx_fingerprint,
      row.source_url,
    ])
  );
}
