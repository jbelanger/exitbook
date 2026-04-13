import type { Account } from '@exitbook/core';
import { assertOk } from '@exitbook/foundation/test-utils';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { TaxPackageBuildContext } from '../tax-package-build-context.js';
import {
  buildAccountLabeler,
  buildArtifactIndex,
  buildCsvFile,
  buildIssueRows,
  countCsvRows,
  formatDate,
  formatMeasure,
  formatMoney,
  formatOptionalMoney,
  formatQuantity,
  makeRef,
  trimTrailingZeros,
} from '../tax-package-builder-shared.js';
import type { TaxPackageFile, TaxPackageIssue } from '../tax-package-types.js';

import { createStandardWorkflowArtifact } from './test-utils.js';

function createTestAccount(
  overrides: Partial<Account> & Pick<Account, 'accountFingerprint' | 'id' | 'identifier' | 'platformKey'>
): Account {
  const { accountFingerprint, id, identifier, platformKey, ...rest } = overrides;

  return {
    id,
    profileId: 1,
    accountType: 'blockchain',
    platformKey,
    identifier,
    accountFingerprint,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...rest,
  };
}

function createTestTaxPackageContext(accounts: readonly Account[]): TaxPackageBuildContext {
  return {
    artifactRef: {
      calculationId: 'calc-1',
      scopeKey: 'scope:test',
      snapshotId: 'snapshot-1',
    },
    workflowResult: createStandardWorkflowArtifact(),
    sourceContext: {
      transactionsById: new Map(),
      accountsById: new Map(accounts.map((account) => [account.id, account])),
      confirmedLinksById: new Map(),
    },
  };
}

describe('buildAccountLabeler', () => {
  it('uses account refs instead of raw identifiers when duplicate platform accounts need disambiguation', () => {
    const context = createTestTaxPackageContext([
      createTestAccount({
        id: 1,
        platformKey: 'solana',
        identifier: 'Afn6A9Vom27wd8AUYqDf2DyUqYWvA34AFGHqcqCgXvMm',
        accountFingerprint: '1111111111abcdef',
      }),
      createTestAccount({
        id: 2,
        platformKey: 'solana',
        identifier: '4Yno2U5DfFJdKmSz9XuUToEFEwnWv6SMx1pd9hJ3YzsP',
        accountFingerprint: '2222222222abcdef',
      }),
    ]);

    const labeler = buildAccountLabeler(context);

    expect(assertOk(labeler(1))).toBe('solana (1111111111)');
    expect(assertOk(labeler(2))).toBe('solana (2222222222)');
    expect(assertOk(labeler(1))).not.toContain('Afn6A9Vom27wd8AU');
  });

  it('keeps the platform label for unique platform accounts', () => {
    const context = createTestTaxPackageContext([
      createTestAccount({
        id: 1,
        platformKey: 'bitcoin',
        identifier: 'bc1qexamplewallet',
        accountFingerprint: '3333333333abcdef',
      }),
    ]);

    const labeler = buildAccountLabeler(context);

    expect(assertOk(labeler(1))).toBe('bitcoin');
  });
});

describe('makeRef', () => {
  it('zero-pads a single-digit index to four digits', () => {
    expect(makeRef('ISSUE', 1)).toBe('ISSUE-0001');
  });

  it('zero-pads a two-digit index', () => {
    expect(makeRef('DISP', 42)).toBe('DISP-0042');
  });

  it('zero-pads a three-digit index', () => {
    expect(makeRef('LOT', 100)).toBe('LOT-0100');
  });

  it('does not pad a four-digit index', () => {
    expect(makeRef('ACQ', 9999)).toBe('ACQ-9999');
  });

  it('does not truncate a five-digit index', () => {
    expect(makeRef('REF', 10001)).toBe('REF-10001');
  });

  it('works with an empty prefix', () => {
    expect(makeRef('', 5)).toBe('-0005');
  });
});

describe('formatDate', () => {
  it('formats a UTC date as YYYY-MM-DD', () => {
    expect(formatDate(new Date('2024-03-15T00:00:00.000Z'))).toBe('2024-03-15');
  });

  it('formats a date with time component (uses UTC ISO date)', () => {
    expect(formatDate(new Date('2024-12-31T23:59:59.999Z'))).toBe('2024-12-31');
  });

  it('formats the first day of the year', () => {
    expect(formatDate(new Date('2024-01-01T00:00:00.000Z'))).toBe('2024-01-01');
  });
});

describe('formatMoney', () => {
  it('formats to two decimal places', () => {
    expect(formatMoney(new Decimal('1234.5'))).toBe('1234.50');
  });

  it('formats zero', () => {
    expect(formatMoney(new Decimal('0'))).toBe('0.00');
  });

  it('rounds to two decimal places', () => {
    expect(formatMoney(new Decimal('99.999'))).toBe('100.00');
  });

  it('formats negative values', () => {
    expect(formatMoney(new Decimal('-1075.50'))).toBe('-1075.50');
  });

  it('preserves exactly two decimal places for whole numbers', () => {
    expect(formatMoney(new Decimal('5000'))).toBe('5000.00');
  });

  it('formats large values', () => {
    expect(formatMoney(new Decimal('1234567.89'))).toBe('1234567.89');
  });
});

describe('formatOptionalMoney', () => {
  it('returns empty string for zero', () => {
    expect(formatOptionalMoney(new Decimal('0'))).toBe('');
  });

  it('returns empty string for negative zero', () => {
    expect(formatOptionalMoney(new Decimal('-0'))).toBe('');
  });

  it('returns formatted money for positive value', () => {
    expect(formatOptionalMoney(new Decimal('1045.00'))).toBe('1045.00');
  });

  it('returns formatted money for negative value', () => {
    expect(formatOptionalMoney(new Decimal('-30'))).toBe('-30.00');
  });

  it('returns formatted money for small non-zero value', () => {
    expect(formatOptionalMoney(new Decimal('0.01'))).toBe('0.01');
  });
});

describe('formatQuantity', () => {
  it('trims trailing zeros from a decimal', () => {
    expect(formatQuantity(new Decimal('1.50000'))).toBe('1.5');
  });

  it('returns a whole number without decimal point', () => {
    expect(formatQuantity(new Decimal('100'))).toBe('100');
  });

  it('preserves significant decimal digits', () => {
    expect(formatQuantity(new Decimal('0.00123'))).toBe('0.00123');
  });

  it('formats zero as "0"', () => {
    expect(formatQuantity(new Decimal('0'))).toBe('0');
  });

  it('handles negative values', () => {
    expect(formatQuantity(new Decimal('-0.250'))).toBe('-0.25');
  });
});

describe('formatMeasure', () => {
  it('trims trailing zeros (same behavior as formatQuantity)', () => {
    expect(formatMeasure(new Decimal('3.14000'))).toBe('3.14');
  });

  it('returns whole number without decimal point', () => {
    expect(formatMeasure(new Decimal('42'))).toBe('42');
  });
});

describe('trimTrailingZeros', () => {
  it('trims trailing zeros after decimal', () => {
    expect(trimTrailingZeros('1.50000')).toBe('1.5');
  });

  it('removes the decimal point when all decimals are zero', () => {
    expect(trimTrailingZeros('100.000')).toBe('100');
  });

  it('returns string unchanged when there is no decimal', () => {
    expect(trimTrailingZeros('42')).toBe('42');
  });

  it('returns string unchanged when no trailing zeros exist', () => {
    expect(trimTrailingZeros('1.23')).toBe('1.23');
  });

  it('preserves leading zeros in the decimal portion', () => {
    expect(trimTrailingZeros('0.00100')).toBe('0.001');
  });

  it('handles just "0"', () => {
    expect(trimTrailingZeros('0')).toBe('0');
  });

  it('removes trailing zeros from a single trailing zero', () => {
    expect(trimTrailingZeros('5.0')).toBe('5');
  });
});

describe('countCsvRows', () => {
  it('returns zero for a CSV with only a header row', () => {
    const file: TaxPackageFile = {
      logicalName: 'test',
      relativePath: 'test.csv',
      mediaType: 'text/csv',
      purpose: 'testing',
      content: 'col_a,col_b\n',
    };

    expect(countCsvRows(file)).toBe(0);
  });

  it('counts data rows excluding the header', () => {
    const file: TaxPackageFile = {
      logicalName: 'test',
      relativePath: 'test.csv',
      mediaType: 'text/csv',
      purpose: 'testing',
      content: 'col_a,col_b\nval1,val2\nval3,val4\nval5,val6\n',
    };

    expect(countCsvRows(file)).toBe(3);
  });

  it('returns undefined for non-CSV media types', () => {
    const file: TaxPackageFile = {
      logicalName: 'manifest',
      relativePath: 'manifest.json',
      mediaType: 'application/json',
      purpose: 'metadata',
      content: '{}',
    };

    expect(countCsvRows(file)).toBeUndefined();
  });

  it('handles content with trailing whitespace', () => {
    const file: TaxPackageFile = {
      logicalName: 'test',
      relativePath: 'test.csv',
      mediaType: 'text/csv',
      purpose: 'testing',
      content: 'header\nrow1\nrow2\n  \n',
    };

    // trimEnd removes trailing whitespace, then splits and subtracts header
    expect(countCsvRows(file)).toBe(2);
  });

  it('returns zero for empty CSV content', () => {
    const file: TaxPackageFile = {
      logicalName: 'test',
      relativePath: 'test.csv',
      mediaType: 'text/csv',
      purpose: 'testing',
      content: '',
    };

    // Empty content: trimEnd gives '', split('\n') gives [''], length=1, 1-1=0
    expect(countCsvRows(file)).toBe(0);
  });
});

describe('buildCsvFile', () => {
  it('builds a TaxPackageFile with CSV content', () => {
    const result = buildCsvFile(
      'disposals',
      'disposals.csv',
      'Disposal schedule',
      ['ref', 'asset', 'quantity'],
      [
        ['DISP-0001', 'BTC', '1.5'],
        ['DISP-0002', 'ETH', '10'],
      ]
    );

    expect(result.logicalName).toBe('disposals');
    expect(result.relativePath).toBe('disposals.csv');
    expect(result.mediaType).toBe('text/csv');
    expect(result.purpose).toBe('Disposal schedule');
    expect(result.content).toBe('ref,asset,quantity\nDISP-0001,BTC,1.5\nDISP-0002,ETH,10\n');
  });

  it('produces a header-only file when there are no rows', () => {
    const result = buildCsvFile('empty', 'empty.csv', 'No data', ['col_a', 'col_b'], []);

    expect(result.content).toBe('col_a,col_b\n');
  });

  it('escapes values containing commas', () => {
    const result = buildCsvFile('test', 'test.csv', 'Test', ['note'], [['hello, world']]);

    expect(result.content).toBe('note\n"hello, world"\n');
  });

  it('escapes values containing double quotes', () => {
    const result = buildCsvFile('test', 'test.csv', 'Test', ['note'], [['say "hi"']]);

    expect(result.content).toBe('note\n"say ""hi"""\n');
  });

  it('escapes values containing newlines', () => {
    const result = buildCsvFile('test', 'test.csv', 'Test', ['note'], [['line1\nline2']]);

    expect(result.content).toBe('note\n"line1\nline2"\n');
  });

  it('row count from countCsvRows matches number of data rows', () => {
    const rows = [
      ['A', '1'],
      ['B', '2'],
      ['C', '3'],
    ];
    const file = buildCsvFile('test', 'test.csv', 'Test', ['key', 'val'], rows);

    expect(countCsvRows(file)).toBe(3);
  });
});

describe('buildArtifactIndex', () => {
  it('maps entries to index format', () => {
    const entries = [
      {
        logicalName: 'disposals',
        relativePath: 'disposals.csv',
        mediaType: 'text/csv',
        purpose: 'Disposal schedule',
        rowCount: 5,
      },
      {
        logicalName: 'manifest',
        relativePath: 'manifest.json',
        mediaType: 'application/json',
        purpose: 'Package metadata',
      },
    ];

    const result = buildArtifactIndex(entries);

    expect(result).toEqual([
      {
        logicalName: 'disposals',
        relativePath: 'disposals.csv',
        mediaType: 'text/csv',
        purpose: 'Disposal schedule',
        rowCount: 5,
      },
      {
        logicalName: 'manifest',
        relativePath: 'manifest.json',
        mediaType: 'application/json',
        purpose: 'Package metadata',
      },
    ]);
  });

  it('omits rowCount property when not provided', () => {
    const entries = [
      {
        logicalName: 'manifest',
        relativePath: 'manifest.json',
        mediaType: 'application/json',
        purpose: 'Metadata',
      },
    ];

    const result = buildArtifactIndex(entries);

    expect(result[0]).not.toHaveProperty('rowCount');
  });

  it('includes rowCount when explicitly zero', () => {
    const entries = [
      {
        logicalName: 'empty',
        relativePath: 'empty.csv',
        mediaType: 'text/csv',
        purpose: 'Empty file',
        rowCount: 0,
      },
    ];

    const result = buildArtifactIndex(entries);

    expect(result[0]!.rowCount).toBe(0);
  });

  it('returns empty array for empty input', () => {
    expect(buildArtifactIndex([])).toEqual([]);
  });
});

describe('buildIssueRows', () => {
  function makeIssue(overrides: Partial<TaxPackageIssue> = {}): TaxPackageIssue {
    return {
      code: 'MISSING_PRICE_DATA',
      severity: 'warning',
      summary: 'Test summary',
      details: 'Test details',
      ...overrides,
    };
  }

  it('assigns sequential ISSUE refs starting at 0001', () => {
    const issues: TaxPackageIssue[] = [
      makeIssue({ code: 'MISSING_PRICE_DATA' }),
      makeIssue({ code: 'FX_FALLBACK_USED' }),
    ];

    const rows = buildIssueRows(issues);

    expect(rows[0]!.issue_ref).toBe('ISSUE-0001');
    expect(rows[1]!.issue_ref).toBe('ISSUE-0002');
  });

  it('sorts blocked issues before warnings', () => {
    const issues: TaxPackageIssue[] = [
      makeIssue({ severity: 'warning', code: 'FX_FALLBACK_USED' }),
      makeIssue({ severity: 'blocked', code: 'MISSING_PRICE_DATA' }),
    ];

    const rows = buildIssueRows(issues);

    expect(rows[0]!.severity).toBe('blocked');
    expect(rows[1]!.severity).toBe('warning');
  });

  it('sorts by code within same severity', () => {
    const issues: TaxPackageIssue[] = [
      makeIssue({ severity: 'warning', code: 'UNRESOLVED_ASSET_REVIEW' }),
      makeIssue({ severity: 'warning', code: 'FX_FALLBACK_USED' }),
      makeIssue({ severity: 'warning', code: 'MISSING_PRICE_DATA' }),
    ];

    const rows = buildIssueRows(issues);

    expect(rows.map((r) => r.code)).toEqual(['FX_FALLBACK_USED', 'MISSING_PRICE_DATA', 'UNRESOLVED_ASSET_REVIEW']);
  });

  it('sorts by affected artifact when severity and code are the same', () => {
    const issues: TaxPackageIssue[] = [
      makeIssue({ code: 'MISSING_PRICE_DATA', affectedArtifact: 'lots.csv' }),
      makeIssue({ code: 'MISSING_PRICE_DATA', affectedArtifact: 'disposals.csv' }),
    ];

    const rows = buildIssueRows(issues);

    expect(rows[0]!.affected_artifact).toBe('disposals.csv');
    expect(rows[1]!.affected_artifact).toBe('lots.csv');
  });

  it('sorts by affected row ref as final tiebreaker', () => {
    const issues: TaxPackageIssue[] = [
      makeIssue({ code: 'MISSING_PRICE_DATA', affectedArtifact: 'lots.csv', affectedRowRef: 'LOT-0002' }),
      makeIssue({ code: 'MISSING_PRICE_DATA', affectedArtifact: 'lots.csv', affectedRowRef: 'LOT-0001' }),
    ];

    const rows = buildIssueRows(issues);

    expect(rows[0]!.affected_row_ref).toBe('LOT-0001');
    expect(rows[1]!.affected_row_ref).toBe('LOT-0002');
  });

  it('maps optional fields to empty strings when absent', () => {
    const issues: TaxPackageIssue[] = [makeIssue()];

    const rows = buildIssueRows(issues);

    expect(rows[0]!.affected_artifact).toBe('');
    expect(rows[0]!.affected_row_ref).toBe('');
  });

  it('uses default recommended action when not provided on the issue', () => {
    const issues: TaxPackageIssue[] = [makeIssue({ code: 'MISSING_PRICE_DATA' })];

    const rows = buildIssueRows(issues);

    expect(rows[0]!.recommended_action).toContain('Enrich or set the missing prices');
  });

  it('uses custom recommended action when provided', () => {
    const issues: TaxPackageIssue[] = [makeIssue({ code: 'MISSING_PRICE_DATA', recommendedAction: 'Custom action' })];

    const rows = buildIssueRows(issues);

    expect(rows[0]!.recommended_action).toBe('Custom action');
  });

  it('returns empty array for empty input', () => {
    expect(buildIssueRows([])).toEqual([]);
  });

  it('maps all fields correctly', () => {
    const issues: TaxPackageIssue[] = [
      makeIssue({
        code: 'FX_FALLBACK_USED',
        severity: 'warning',
        summary: 'FX fallback',
        details: 'Used fallback rate',
        affectedArtifact: 'disposals.csv',
        affectedRowRef: 'DISP-0001',
        recommendedAction: 'Review FX rates',
      }),
    ];

    const rows = buildIssueRows(issues);

    expect(rows[0]).toEqual({
      issue_ref: 'ISSUE-0001',
      code: 'FX_FALLBACK_USED',
      severity: 'warning',
      summary: 'FX fallback',
      details: 'Used fallback rate',
      affected_artifact: 'disposals.csv',
      affected_row_ref: 'DISP-0001',
      recommended_action: 'Review FX rates',
    });
  });

  it('does not mutate the original array', () => {
    const issues: TaxPackageIssue[] = [
      makeIssue({ severity: 'warning', code: 'UNRESOLVED_ASSET_REVIEW' }),
      makeIssue({ severity: 'blocked', code: 'MISSING_PRICE_DATA' }),
    ];

    const originalFirst = issues[0];
    buildIssueRows(issues);

    expect(issues[0]).toBe(originalFirst);
  });
});
