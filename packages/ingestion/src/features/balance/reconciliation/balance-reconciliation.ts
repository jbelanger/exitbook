import { err, ok, parseDecimal, tryParseDecimal, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

export type BalanceReferenceSource = 'live' | 'stored';

export type BalanceReconciliationStatus =
  | 'category_unsupported'
  | 'matched'
  | 'missing_reference'
  | 'quantity_mismatch'
  | 'unexpected_reference';

export interface BalanceReconciliationInputRow {
  accountId: number;
  assetId: string;
  balanceCategory: string;
  quantity: string;
  assetSymbol?: string | undefined;
  refs?: readonly string[] | undefined;
}

export interface BalanceReconciliationUnsupportedReferenceRow {
  accountId: number;
  assetId: string;
  balanceCategory: string;
  assetSymbol?: string | undefined;
  reason?: string | undefined;
}

export interface BalanceReconciliationRow {
  accountId: number;
  assetId: string;
  assetSymbol: string;
  balanceCategory: string;
  diffQuantity: string;
  expectedQuantity: string;
  expectedRefs: readonly string[];
  referenceQuantity: string;
  referenceRefs: readonly string[];
  referenceSource: BalanceReferenceSource;
  referenceUnavailableReason?: string | undefined;
  status: BalanceReconciliationStatus;
}

export interface BalanceReconciliationSummary {
  categoryUnsupported: number;
  matched: number;
  missingReference: number;
  quantityMismatches: number;
  totalRows: number;
  unexpectedReference: number;
}

export interface BalanceReconciliationResult {
  rows: BalanceReconciliationRow[];
  summary: BalanceReconciliationSummary;
}

export interface ReconcileBalanceRowsParams {
  expectedRows: readonly BalanceReconciliationInputRow[];
  referenceRows: readonly BalanceReconciliationInputRow[];
  referenceSource: BalanceReferenceSource;
  tolerance?: string | undefined;
  unsupportedReferenceRows?: readonly BalanceReconciliationUnsupportedReferenceRow[] | undefined;
}

interface AggregatedBalanceRow {
  accountId: number;
  assetId: string;
  assetSymbol: string;
  balanceCategory: string;
  quantity: Decimal;
  refs: string[];
}

type BalanceRowKind = 'expected' | 'reference';

export function reconcileBalanceRows(params: ReconcileBalanceRowsParams): Result<BalanceReconciliationResult, Error> {
  const toleranceResult = parseReconciliationQuantity(params.tolerance ?? '0.00000001', 'tolerance');
  if (toleranceResult.isErr()) return err(toleranceResult.error);

  const expectedRowsResult = aggregateBalanceRows(params.expectedRows, 'expected');
  if (expectedRowsResult.isErr()) return err(expectedRowsResult.error);

  const referenceRowsResult = aggregateBalanceRows(params.referenceRows, 'reference');
  if (referenceRowsResult.isErr()) return err(referenceRowsResult.error);

  const unsupportedReferenceRows = aggregateUnsupportedReferenceRows(params.unsupportedReferenceRows ?? []);

  const tolerance = toleranceResult.value;
  const expectedRows = expectedRowsResult.value;
  const referenceRows = referenceRowsResult.value;
  const allKeys = [...new Set([...expectedRows.keys(), ...referenceRows.keys()])];
  const rows: BalanceReconciliationRow[] = [];
  for (const key of allKeys) {
    const expected = expectedRows.get(key);
    const reference = referenceRows.get(key);
    if (expected === undefined && reference !== undefined && reference.quantity.abs().lessThanOrEqualTo(tolerance)) {
      continue;
    }

    const rowResult = buildReconciliationRow({
      expected,
      reference,
      referenceSource: params.referenceSource,
      tolerance,
      unsupportedReference: unsupportedReferenceRows.get(key),
    });
    if (rowResult.isErr()) return err(rowResult.error);
    rows.push(rowResult.value);
  }
  rows.sort(compareReconciliationRows);

  return ok({
    rows,
    summary: summarizeReconciliationRows(rows),
  });
}

function aggregateUnsupportedReferenceRows(
  rows: readonly BalanceReconciliationUnsupportedReferenceRow[]
): Map<string, BalanceReconciliationUnsupportedReferenceRow> {
  const rowsByKey = new Map<string, BalanceReconciliationUnsupportedReferenceRow>();

  for (const row of rows) {
    rowsByKey.set(buildBalanceReconciliationKey(row), row);
  }

  return rowsByKey;
}

function aggregateBalanceRows(
  rows: readonly BalanceReconciliationInputRow[],
  kind: BalanceRowKind
): Result<Map<string, AggregatedBalanceRow>, Error> {
  const rowsByKey = new Map<string, AggregatedBalanceRow>();

  for (const row of rows) {
    const key = buildBalanceReconciliationKey(row);
    const quantityResult = parseReconciliationQuantity(row.quantity, `${kind} quantity for ${key}`);
    if (quantityResult.isErr()) return err(quantityResult.error);

    const quantity = quantityResult.value;
    const existing = rowsByKey.get(key);

    if (!existing) {
      rowsByKey.set(key, {
        accountId: row.accountId,
        assetId: row.assetId,
        assetSymbol: row.assetSymbol ?? row.assetId,
        balanceCategory: row.balanceCategory,
        quantity,
        refs: [...(row.refs ?? [])],
      });
      continue;
    }

    existing.quantity = existing.quantity.plus(quantity);
    existing.refs.push(...(row.refs ?? []));
    if (existing.assetSymbol === existing.assetId && row.assetSymbol !== undefined) {
      existing.assetSymbol = row.assetSymbol;
    }
  }

  return ok(rowsByKey);
}

function buildReconciliationRow(params: {
  expected: AggregatedBalanceRow | undefined;
  reference: AggregatedBalanceRow | undefined;
  referenceSource: BalanceReferenceSource;
  tolerance: Decimal;
  unsupportedReference: BalanceReconciliationUnsupportedReferenceRow | undefined;
}): Result<BalanceReconciliationRow, Error> {
  if (params.reference && params.unsupportedReference) {
    return err(
      new Error(
        `Balance reconciliation reference ${buildBalanceReconciliationKey(params.reference)} cannot be both available and unsupported`
      )
    );
  }

  const expectedQuantity = params.expected?.quantity ?? parseDecimal('0');
  const referenceQuantity = params.reference?.quantity ?? parseDecimal('0');
  const diffQuantity = expectedQuantity.minus(referenceQuantity);
  const template = params.expected ?? params.reference ?? params.unsupportedReference;

  if (!template) {
    return err(new Error('Cannot build a balance reconciliation row without either side'));
  }

  return ok({
    accountId: template.accountId,
    assetId: template.assetId,
    assetSymbol: params.expected?.assetSymbol ?? params.reference?.assetSymbol ?? template.assetId,
    balanceCategory: template.balanceCategory,
    diffQuantity: diffQuantity.toFixed(),
    expectedQuantity: expectedQuantity.toFixed(),
    expectedRefs: params.expected?.refs ?? [],
    referenceQuantity: referenceQuantity.toFixed(),
    referenceRefs: params.reference?.refs ?? [],
    referenceSource: params.referenceSource,
    ...(params.unsupportedReference?.reason !== undefined && {
      referenceUnavailableReason: params.unsupportedReference.reason,
    }),
    status: getReconciliationStatus({
      diffQuantity,
      hasExpected: params.expected !== undefined,
      hasReference: params.reference !== undefined,
      tolerance: params.tolerance,
      unsupportedReference: params.unsupportedReference !== undefined,
    }),
  });
}

function getReconciliationStatus(params: {
  diffQuantity: Decimal;
  hasExpected: boolean;
  hasReference: boolean;
  tolerance: Decimal;
  unsupportedReference: boolean;
}): BalanceReconciliationStatus {
  if (params.unsupportedReference) {
    return 'category_unsupported';
  }
  if (!params.hasReference) {
    return 'missing_reference';
  }
  if (!params.hasExpected) {
    return 'unexpected_reference';
  }
  if (params.diffQuantity.abs().lessThanOrEqualTo(params.tolerance)) {
    return 'matched';
  }
  return 'quantity_mismatch';
}

function summarizeReconciliationRows(rows: readonly BalanceReconciliationRow[]): BalanceReconciliationSummary {
  return {
    categoryUnsupported: rows.filter((row) => row.status === 'category_unsupported').length,
    matched: rows.filter((row) => row.status === 'matched').length,
    missingReference: rows.filter((row) => row.status === 'missing_reference').length,
    quantityMismatches: rows.filter((row) => row.status === 'quantity_mismatch').length,
    totalRows: rows.length,
    unexpectedReference: rows.filter((row) => row.status === 'unexpected_reference').length,
  };
}

function compareReconciliationRows(a: BalanceReconciliationRow, b: BalanceReconciliationRow): number {
  return (
    a.accountId - b.accountId ||
    a.assetId.localeCompare(b.assetId) ||
    a.balanceCategory.localeCompare(b.balanceCategory)
  );
}

function buildBalanceReconciliationKey(
  row: Pick<BalanceReconciliationInputRow, 'accountId' | 'assetId' | 'balanceCategory'>
): string {
  return `${row.accountId}\u0000${row.assetId}\u0000${row.balanceCategory}`;
}

function parseReconciliationQuantity(quantity: string, label: string): Result<Decimal, Error> {
  const parsed = { value: parseDecimal('0') };
  if (quantity.trim().length === 0 || !tryParseDecimal(quantity, parsed)) {
    return err(new Error(`Invalid balance reconciliation ${label}: ${quantity}`));
  }
  return ok(parsed.value);
}
