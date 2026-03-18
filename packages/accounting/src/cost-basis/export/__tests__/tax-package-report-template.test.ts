import { describe, expect, it } from 'vitest';

import { buildTaxPackageReportTemplate } from '../tax-package-report-template.js';
import type { TaxPackageIssue, TaxPackageStatus } from '../tax-package-types.js';

function createBaseInput(overrides?: {
  blockingIssues?: TaxPackageIssue[];
  fileDescriptions?: { name: string; purpose: string }[];
  filingNotes?: string[];
  packageStatus?: TaxPackageStatus;
  summaryTotals?: {
    totalCostBasis: string;
    totalGainLoss: string;
    totalProceeds: string;
    totalTaxableGainLoss: string;
  };
  taxCurrency?: string;
  warnings?: TaxPackageIssue[];
}) {
  return {
    title: 'Tax Package Report - US 2024',
    generatedAt: new Date('2026-03-15T12:00:00.000Z'),
    manifest: {
      jurisdiction: 'US' as const,
      method: 'fifo' as const,
      packageStatus: overrides?.packageStatus ?? 'ready',
      summaryTotals: overrides?.summaryTotals ?? {
        totalProceeds: '12000.00',
        totalCostBasis: '10000.00',
        totalGainLoss: '2000.00',
        totalTaxableGainLoss: '2000.00',
      },
      taxCurrency: overrides?.taxCurrency ?? 'USD',
      taxYear: 2024,
    },
    blockingIssues: overrides?.blockingIssues ?? [],
    warnings: overrides?.warnings ?? [],
    fileDescriptions: overrides?.fileDescriptions ?? [],
    filingNotes: overrides?.filingNotes ?? [],
  };
}

function createIssue(overrides?: Partial<TaxPackageIssue>): TaxPackageIssue {
  return {
    code: 'MISSING_PRICE_DATA',
    severity: 'blocked',
    summary: '2 transactions have missing price data',
    details: 'Transactions 101, 102 could not be priced.',
    ...overrides,
  };
}

describe('buildTaxPackageReportTemplate', () => {
  describe('ready status with no issues', () => {
    it('renders header with title, status, and metadata', () => {
      const result = buildTaxPackageReportTemplate(createBaseInput());

      expect(result).toContain('# Tax Package Report - US 2024');
      expect(result).toContain('Status: ready');
      expect(result).toContain('Generated: 2026-03-15T12:00:00.000Z');
      expect(result).toContain('Jurisdiction: US');
      expect(result).toContain('Tax year: 2024');
      expect(result).toContain('Method: fifo');
      expect(result).toContain('Tax currency: USD');
    });

    it('renders summary totals with currency', () => {
      const result = buildTaxPackageReportTemplate(createBaseInput());

      expect(result).toContain('## Summary Totals');
      expect(result).toContain('- Total proceeds: 12000.00 USD');
      expect(result).toContain('- Total cost basis: 10000.00 USD');
      expect(result).toContain('- Total gain/loss: 2000.00 USD');
      expect(result).toContain('- Total taxable gain/loss: 2000.00 USD');
    });

    it('shows zero counts in readiness section', () => {
      const result = buildTaxPackageReportTemplate(createBaseInput());

      expect(result).toContain('## Readiness');
      expect(result).toContain('- Blocking issues: 0');
      expect(result).toContain('- Warnings: 0');
    });

    it('renders "None" for empty blocking issues and warnings sections', () => {
      const result = buildTaxPackageReportTemplate(createBaseInput());

      expect(result).toContain('## Blocking Issues\n\n- None');
      expect(result).toContain('## Warnings\n\n- None');
    });

    it('includes default filing notes', () => {
      const result = buildTaxPackageReportTemplate(createBaseInput());

      expect(result).toContain('## Filing Notes');
      expect(result).toContain('- Dates use YYYY-MM-DD.');
      expect(result).toContain(
        '- Spreadsheet tools may require date columns to be explicitly formatted as dates for sorting.'
      );
      expect(result).toContain(
        '- Transfer and network-fee activity that is treated as a taxable disposal appears in dispositions.csv. Non-taxable internal carryovers appear in transfers.csv.'
      );
    });
  });

  describe('blocked status with blocking issues and warnings', () => {
    it('renders blocked status label', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          packageStatus: 'blocked',
          blockingIssues: [createIssue()],
        })
      );

      expect(result).toContain('Status: blocked');
    });

    it('renders correct issue and warning counts', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          packageStatus: 'blocked',
          blockingIssues: [
            createIssue({ code: 'MISSING_PRICE_DATA' }),
            createIssue({ code: 'UNRESOLVED_ASSET_REVIEW' }),
          ],
          warnings: [
            createIssue({
              code: 'FX_FALLBACK_USED',
              severity: 'warning',
              summary: 'FX fallback was used for 3 prices',
            }),
          ],
        })
      );

      expect(result).toContain('- Blocking issues: 2');
      expect(result).toContain('- Warnings: 1');
    });

    it('lists blocking issues with code and summary', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          packageStatus: 'blocked',
          blockingIssues: [
            createIssue({
              code: 'MISSING_PRICE_DATA',
              summary: '2 transactions have missing price data',
            }),
            createIssue({
              code: 'UNRESOLVED_ASSET_REVIEW',
              summary: '1 asset requires manual review',
              details: 'Asset XYZ is unrecognized.',
            }),
          ],
        })
      );

      expect(result).toContain('- MISSING_PRICE_DATA: 2 transactions have missing price data');
      expect(result).toContain('- UNRESOLVED_ASSET_REVIEW: 1 asset requires manual review');
    });

    it('lists warnings with code and summary', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          warnings: [
            createIssue({
              code: 'FX_FALLBACK_USED',
              severity: 'warning',
              summary: 'FX fallback was used for 3 prices',
              details: '',
              recommendedAction: undefined,
            }),
          ],
        })
      );

      expect(result).toContain('## Warnings');
      expect(result).toContain('- FX_FALLBACK_USED: FX fallback was used for 3 prices');
    });
  });

  describe('issues with details and recommended actions', () => {
    it('renders issue details indented below the issue line', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          packageStatus: 'blocked',
          blockingIssues: [
            createIssue({
              code: 'MISSING_PRICE_DATA',
              summary: '2 transactions have missing price data',
              details: 'Transactions 101, 102 could not be priced.',
            }),
          ],
        })
      );

      expect(result).toContain('- MISSING_PRICE_DATA: 2 transactions have missing price data');
      expect(result).toContain('  Transactions 101, 102 could not be priced.');
    });

    it('renders recommended action indented below the issue', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          packageStatus: 'blocked',
          blockingIssues: [
            createIssue({
              code: 'MISSING_PRICE_DATA',
              summary: '2 transactions have missing price data',
              details: 'Transactions 101, 102 could not be priced.',
              recommendedAction: 'Run prices enrich to fetch missing prices.',
            }),
          ],
        })
      );

      expect(result).toContain('  Recommended action: Run prices enrich to fetch missing prices.');
    });

    it('omits details line when details is empty', () => {
      const issue = createIssue({
        details: '',
        recommendedAction: 'Re-run the import.',
      });

      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          packageStatus: 'blocked',
          blockingIssues: [issue],
        })
      );

      const lines = result.split('\n');
      const issueLine = lines.findIndex((l) => l.includes(`- ${issue.code}: ${issue.summary}`));
      // The next non-empty content line should be the recommended action, not a details line
      expect(lines[issueLine + 1]).toBe('  Recommended action: Re-run the import.');
    });

    it('omits recommended action line when recommendedAction is undefined', () => {
      const issue = createIssue({
        details: 'Some detail here.',
        recommendedAction: undefined,
      });

      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          blockingIssues: [issue],
        })
      );

      expect(result).not.toContain('Recommended action:');
    });
  });

  describe('file descriptions', () => {
    it('lists each file with name and purpose', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          fileDescriptions: [
            { name: 'dispositions.csv', purpose: 'All taxable dispositions for the period' },
            { name: 'lots.csv', purpose: 'Cost basis lot inventory' },
            { name: 'manifest.json', purpose: 'Machine-readable package metadata' },
          ],
        })
      );

      expect(result).toContain('## Included Files');
      expect(result).toContain('- dispositions.csv: All taxable dispositions for the period');
      expect(result).toContain('- lots.csv: Cost basis lot inventory');
      expect(result).toContain('- manifest.json: Machine-readable package metadata');
    });

    it('renders empty included files section when no files are described', () => {
      const result = buildTaxPackageReportTemplate(createBaseInput({ fileDescriptions: [] }));

      expect(result).toContain('## Included Files');
    });
  });

  describe('filing notes', () => {
    it('appends custom filing notes after the default notes', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          filingNotes: [
            'Wash sale adjustments are applied per IRS rules.',
            'All amounts are rounded to two decimal places.',
          ],
        })
      );

      expect(result).toContain('## Filing Notes');
      // Default notes come first
      expect(result).toContain('- Dates use YYYY-MM-DD.');
      // Custom notes appended
      expect(result).toContain('- Wash sale adjustments are applied per IRS rules.');
      expect(result).toContain('- All amounts are rounded to two decimal places.');
    });

    it('preserves order of custom filing notes', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          filingNotes: ['First custom note.', 'Second custom note.'],
        })
      );

      const firstIndex = result.indexOf('- First custom note.');
      const secondIndex = result.indexOf('- Second custom note.');
      expect(firstIndex).toBeLessThan(secondIndex);
    });
  });

  describe('summary totals with different currencies', () => {
    it('renders totals with CAD currency', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          taxCurrency: 'CAD',
          summaryTotals: {
            totalProceeds: '36000.00',
            totalCostBasis: '30000.00',
            totalGainLoss: '6000.00',
            totalTaxableGainLoss: '3000.00',
          },
        })
      );

      expect(result).toContain('Tax currency: CAD');
      expect(result).toContain('- Total proceeds: 36000.00 CAD');
      expect(result).toContain('- Total cost basis: 30000.00 CAD');
      expect(result).toContain('- Total gain/loss: 6000.00 CAD');
      expect(result).toContain('- Total taxable gain/loss: 3000.00 CAD');
    });

    it('renders negative gain/loss values', () => {
      const result = buildTaxPackageReportTemplate(
        createBaseInput({
          summaryTotals: {
            totalProceeds: '8000.00',
            totalCostBasis: '10000.00',
            totalGainLoss: '-2000.00',
            totalTaxableGainLoss: '-2000.00',
          },
        })
      );

      expect(result).toContain('- Total gain/loss: -2000.00 USD');
      expect(result).toContain('- Total taxable gain/loss: -2000.00 USD');
    });
  });
});
