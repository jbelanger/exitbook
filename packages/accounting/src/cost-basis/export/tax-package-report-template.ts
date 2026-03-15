import type { TaxPackageIssue, TaxPackageManifest, TaxPackageStatus } from './tax-package-types.js';

interface TaxPackageReportTemplateInput {
  blockingIssues: readonly TaxPackageIssue[];
  fileDescriptions: readonly { name: string; purpose: string }[];
  filingNotes: readonly string[];
  generatedAt: Date;
  manifest: Pick<
    TaxPackageManifest,
    'jurisdiction' | 'method' | 'packageStatus' | 'summaryTotals' | 'taxCurrency' | 'taxYear'
  >;
  reviewItems: readonly TaxPackageIssue[];
  title: string;
}

export function buildTaxPackageReportTemplate(input: TaxPackageReportTemplateInput): string {
  const statusLabel = describeStatus(input.manifest.packageStatus);
  const lines = [
    `# ${input.title}`,
    '',
    `Status: ${statusLabel}`,
    `Generated: ${input.generatedAt.toISOString()}`,
    `Jurisdiction: ${input.manifest.jurisdiction}`,
    `Tax year: ${input.manifest.taxYear}`,
    `Method: ${input.manifest.method}`,
    `Tax currency: ${input.manifest.taxCurrency}`,
    '',
    '## Summary Totals',
    '',
    `- Total proceeds: ${input.manifest.summaryTotals.totalProceeds} ${input.manifest.taxCurrency}`,
    `- Total cost basis: ${input.manifest.summaryTotals.totalCostBasis} ${input.manifest.taxCurrency}`,
    `- Total gain/loss: ${input.manifest.summaryTotals.totalGainLoss} ${input.manifest.taxCurrency}`,
    `- Total taxable gain/loss: ${input.manifest.summaryTotals.totalTaxableGainLoss} ${input.manifest.taxCurrency}`,
    '',
    '## Readiness',
    '',
    `- Blocking issues: ${input.blockingIssues.length}`,
    `- Review items: ${input.reviewItems.length}`,
    '',
    ...renderIssueSection('Blocking Issues', input.blockingIssues),
    ...renderIssueSection('Review Items', input.reviewItems),
    '## Included Files',
    '',
    ...input.fileDescriptions.map((file) => `- ${file.name}: ${file.purpose}`),
    '',
    '## Filing Notes',
    '',
    '- Dates use YYYY-MM-DD.',
    '- Spreadsheet tools may require date columns to be explicitly formatted as dates for sorting.',
    '- Transfer and network-fee activity that is treated as a taxable disposal appears in dispositions.csv. Non-taxable internal carryovers appear in transfers.csv.',
    ...input.filingNotes.map((note) => `- ${note}`),
    '',
  ];

  return lines.join('\n');
}

function renderIssueSection(title: string, issues: readonly TaxPackageIssue[]): string[] {
  if (issues.length === 0) {
    return [`## ${title}`, '', '- None', ''];
  }

  return [
    `## ${title}`,
    '',
    ...issues.flatMap((issue) => {
      const lines = [`- ${issue.code}: ${issue.summary}`];
      if (issue.details) {
        lines.push(`  ${issue.details}`);
      }
      if (issue.recommendedAction) {
        lines.push(`  Recommended action: ${issue.recommendedAction}`);
      }
      return lines;
    }),
    '',
  ];
}

function describeStatus(status: TaxPackageStatus): string {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'review_required':
      return 'review required';
    case 'blocked':
      return 'blocked';
  }
}
