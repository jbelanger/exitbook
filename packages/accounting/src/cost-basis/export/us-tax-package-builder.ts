import { err, ok, type Result } from '@exitbook/core';

import type { StandardCostBasisFilingFacts } from '../filing-facts/filing-facts-types.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import {
  buildAccountLabeler,
  buildArtifactIndex,
  buildCsvFile,
  buildIssueRows,
  countAccountsBySourceName,
  countCsvRows,
  formatMoney,
  type TaxPackageIssueCsvRow,
  type TaxPackageSourceLinkRow,
} from './tax-package-builder-shared.js';
import { buildTaxPackageReportTemplate } from './tax-package-report-template.js';
import type {
  TaxPackageArtifactIndexEntry,
  TaxPackageBuildResult,
  TaxPackageFile,
  TaxPackageManifest,
  TaxPackageReadinessResult,
} from './tax-package-types.js';
import { TAX_PACKAGE_KIND, TAX_PACKAGE_VERSION } from './tax-package-types.js';
import {
  buildUsAssetLabeler,
  buildUsDispositionRows,
  buildUsLotRows,
  buildUsRowRefMaps,
  buildUsSourceLinkRows,
  buildUsTransferRows,
  type UsDispositionRow,
  type UsLotRow,
  type UsTransferRow,
} from './us-tax-package-renderers.js';

interface BuildUsTaxPackageParams {
  context: TaxPackageBuildContext;
  filingFacts: StandardCostBasisFilingFacts;
  now: () => Date;
  readiness: TaxPackageReadinessResult;
}

export function buildUsTaxPackage(params: BuildUsTaxPackageParams): Result<TaxPackageBuildResult, Error> {
  if (params.context.workflowResult.kind !== 'standard-workflow') {
    return err(new Error('US tax package builder requires a standard-workflow artifact'));
  }
  if (params.filingFacts.kind !== 'standard') {
    return err(new Error('US tax package builder requires standard filing facts'));
  }

  const accountLabeler = buildAccountLabeler(params.context);
  const assetLabeler = buildUsAssetLabeler(params.filingFacts);
  const generatedAt = params.now();

  let supportingFiles: TaxPackageFile[];
  if (params.readiness.status === 'blocked') {
    supportingFiles = buildBlockedSupportingFiles(params.readiness);
  } else {
    const completeResult = buildUsSupportingFiles({
      accountLabeler,
      assetLabeler,
      context: params.context,
      filingFacts: params.filingFacts,
      readiness: params.readiness,
    });
    if (completeResult.isErr()) {
      return err(completeResult.error);
    }
    supportingFiles = completeResult.value;
  }

  const artifactIndex = buildArtifactIndex([
    {
      logicalName: 'manifest',
      relativePath: 'manifest.json',
      mediaType: 'application/json',
      purpose: 'Stable machine-readable contract and audit index.',
    },
    {
      logicalName: 'report',
      relativePath: 'report.md',
      mediaType: 'text/markdown',
      purpose: 'Human entrypoint with readiness, totals, and file guidance.',
    },
    ...supportingFiles.map((file) => ({
      logicalName: file.logicalName,
      relativePath: file.relativePath,
      mediaType: file.mediaType,
      purpose: file.purpose,
      rowCount: countCsvRows(file),
    })),
  ]);

  const manifest = buildManifest({
    artifactIndex,
    context: params.context,
    filingFacts: params.filingFacts,
    generatedAt,
    readiness: params.readiness,
  });
  const report = buildReport({
    generatedAt,
    manifest,
    readiness: params.readiness,
  });

  return ok({
    files: [
      {
        logicalName: 'manifest',
        relativePath: 'manifest.json',
        mediaType: 'application/json',
        purpose: 'Stable machine-readable contract and audit index.',
        content: `${JSON.stringify(manifest, undefined, 2)}\n`,
      },
      {
        logicalName: 'report',
        relativePath: 'report.md',
        mediaType: 'text/markdown',
        purpose: 'Human entrypoint with readiness, totals, and file guidance.',
        content: report,
      },
      ...supportingFiles,
    ],
    manifest,
    status: params.readiness.status,
  });
}

function buildUsSupportingFiles(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string | undefined) => string;
  context: TaxPackageBuildContext;
  filingFacts: StandardCostBasisFilingFacts;
  readiness: TaxPackageReadinessResult;
}): Result<TaxPackageFile[], Error> {
  const rowRefMapsResult = buildUsRowRefMaps({
    context: params.context,
    filingFacts: params.filingFacts,
    accountLabeler: params.accountLabeler,
    assetLabeler: params.assetLabeler,
  });
  if (rowRefMapsResult.isErr()) {
    return err(rowRefMapsResult.error);
  }
  const rowRefMaps = rowRefMapsResult.value;
  const sourceNameCounts = countAccountsBySourceName(params.context);

  const dispositionRowsResult = buildUsDispositionRows({
    context: params.context,
    filingFacts: params.filingFacts,
    accountLabeler: params.accountLabeler,
    assetLabeler: params.assetLabeler,
    rowRefMaps,
  });
  if (dispositionRowsResult.isErr()) {
    return err(dispositionRowsResult.error);
  }

  const lotRowsResult = buildUsLotRows({
    context: params.context,
    filingFacts: params.filingFacts,
    accountLabeler: params.accountLabeler,
    assetLabeler: params.assetLabeler,
    rowRefMaps,
  });
  if (lotRowsResult.isErr()) {
    return err(lotRowsResult.error);
  }

  const transferRowsResult = buildUsTransferRows({
    context: params.context,
    filingFacts: params.filingFacts,
    accountLabeler: params.accountLabeler,
    assetLabeler: params.assetLabeler,
    rowRefMaps,
  });
  if (transferRowsResult.isErr()) {
    return err(transferRowsResult.error);
  }

  const issueRows = buildIssueRows(params.readiness.issues);
  const sourceLinkRowsResult = buildUsSourceLinkRows({
    context: params.context,
    filingFacts: params.filingFacts,
    rowRefMaps,
    sourceNameCounts,
  });
  if (sourceLinkRowsResult.isErr()) {
    return err(sourceLinkRowsResult.error);
  }

  const files: TaxPackageFile[] = [
    buildDispositionsCsvFile(dispositionRowsResult.value),
    buildTransfersCsvFile(transferRowsResult.value),
    buildLotsCsvFile(lotRowsResult.value),
  ];

  if (issueRows.length > 0) {
    files.push(buildUsIssuesCsvFile(issueRows));
  }

  if (sourceLinkRowsResult.value.length > 0) {
    files.push(buildUsSourceLinksCsvFile(sourceLinkRowsResult.value));
  }

  return ok(files);
}

function buildBlockedSupportingFiles(readiness: TaxPackageReadinessResult): TaxPackageFile[] {
  if (readiness.issues.length === 0) {
    return [];
  }

  return [buildUsIssuesCsvFile(buildIssueRows(readiness.issues))];
}

function buildManifest(params: {
  artifactIndex: readonly TaxPackageArtifactIndexEntry[];
  context: TaxPackageBuildContext;
  filingFacts: StandardCostBasisFilingFacts;
  generatedAt: Date;
  readiness: TaxPackageReadinessResult;
}): TaxPackageManifest {
  return {
    packageKind: TAX_PACKAGE_KIND,
    packageVersion: TAX_PACKAGE_VERSION,
    packageStatus: params.readiness.status,
    jurisdiction: 'US',
    taxYear: params.filingFacts.taxYear,
    calculationId: params.context.artifactRef.calculationId,
    snapshotId: params.context.artifactRef.snapshotId,
    scopeKey: params.context.artifactRef.scopeKey,
    generatedAt: params.generatedAt.toISOString(),
    method: params.filingFacts.method,
    taxCurrency: params.filingFacts.taxCurrency,
    summaryTotals: {
      totalProceeds: formatMoney(params.filingFacts.summary.totalProceeds),
      totalCostBasis: formatMoney(params.filingFacts.summary.totalCostBasis),
      totalGainLoss: formatMoney(params.filingFacts.summary.totalGainLoss),
      totalTaxableGainLoss: formatMoney(params.filingFacts.summary.totalTaxableGainLoss),
    },
    warnings: params.readiness.warnings,
    blockingIssues: params.readiness.blockingIssues,
    artifactIndex: params.artifactIndex,
  };
}

function buildReport(params: {
  generatedAt: Date;
  manifest: TaxPackageManifest;
  readiness: TaxPackageReadinessResult;
}): string {
  return buildTaxPackageReportTemplate({
    title: 'US Cost Basis Tax Package',
    generatedAt: params.generatedAt,
    manifest: {
      ...params.manifest,
      packageStatus: params.readiness.status,
    },
    blockingIssues: params.readiness.blockingIssues,
    warnings: params.readiness.warnings,
    fileDescriptions: params.manifest.artifactIndex.map((item) => ({
      name: item.relativePath,
      purpose: item.purpose,
    })),
    filingNotes: [
      'dispositions.csv intentionally omits downstream Form 8949 box placement and adjustment-code mapping; use the package facts as preparer support rather than return-placement instructions.',
      'tax_treatment comes from the shared accounting filing-facts seam, so CLI and export use the same canonical U.S. holding-period classification.',
      'basis_source remains lot_carryover for v1 standard transfers even when cost_basis_carried includes same-asset fee basis; the fee basis is reflected in the amount columns rather than by relabeling the carryover origin.',
      'lots.csv is the lot-identity appendix used to tie each disposition row back to the matched acquisition lot.',
    ],
  });
}

function buildDispositionsCsvFile(rows: readonly UsDispositionRow[]): TaxPackageFile {
  return buildCsvFile(
    'dispositions',
    'dispositions.csv',
    'Primary filing-support table for US lot-matched dispositions.',
    [
      'disposition_ref',
      'disposition_group',
      'asset',
      'account_label',
      'date_disposed',
      'quantity_disposed',
      'proceeds_gross',
      'selling_expenses',
      'net_proceeds',
      'cost_basis',
      'gain_loss',
      'tax_currency',
      'date_acquired',
      'holding_period_days',
      'tax_treatment',
      'lot_ref',
    ],
    rows.map((row) => [
      row.disposition_ref,
      row.disposition_group,
      row.asset,
      row.account_label,
      row.date_disposed,
      row.quantity_disposed,
      row.proceeds_gross,
      row.selling_expenses,
      row.net_proceeds,
      row.cost_basis,
      row.gain_loss,
      row.tax_currency,
      row.date_acquired,
      row.holding_period_days,
      row.tax_treatment,
      row.lot_ref,
    ])
  );
}

function buildTransfersCsvFile(rows: readonly UsTransferRow[]): TaxPackageFile {
  return buildCsvFile(
    'transfers',
    'transfers.csv',
    'Audit appendix for internal carryovers and transferred lot basis.',
    [
      'transfer_ref',
      'asset',
      'date_transferred',
      'transfer_status',
      'transfer_direction',
      'source_account_label',
      'target_account_label',
      'quantity_transferred',
      'cost_basis_carried',
      'tax_currency',
      'cost_basis_per_unit',
      'basis_source',
      'source_lot_ref',
    ],
    rows.map((row) => [
      row.transfer_ref,
      row.asset,
      row.date_transferred,
      row.transfer_status,
      row.transfer_direction,
      row.source_account_label,
      row.target_account_label,
      row.quantity_transferred,
      row.cost_basis_carried,
      row.tax_currency,
      row.cost_basis_per_unit,
      row.basis_source,
      row.source_lot_ref,
    ])
  );
}

function buildLotsCsvFile(rows: readonly UsLotRow[]): TaxPackageFile {
  return buildCsvFile(
    'lots',
    'lots.csv',
    'US lot-identity appendix for acquisition context and ending balances.',
    [
      'lot_ref',
      'asset',
      'account_label',
      'date_acquired',
      'origin_period',
      'quantity_acquired',
      'cost_basis_per_unit',
      'total_cost_basis',
      'remaining_quantity',
      'lot_status',
      'tax_currency',
    ],
    rows.map((row) => [
      row.lot_ref,
      row.asset,
      row.account_label,
      row.date_acquired,
      row.origin_period,
      row.quantity_acquired,
      row.cost_basis_per_unit,
      row.total_cost_basis,
      row.remaining_quantity,
      row.lot_status,
      row.tax_currency,
    ])
  );
}

function buildUsIssuesCsvFile(rows: readonly TaxPackageIssueCsvRow[]): TaxPackageFile {
  return buildCsvFile(
    'issues',
    'issues.csv',
    'Readiness and review issues for the tax package.',
    [
      'issue_ref',
      'code',
      'severity',
      'summary',
      'details',
      'affected_artifact',
      'affected_row_ref',
      'recommended_action',
    ],
    rows.map((row) => [
      row.issue_ref,
      row.code,
      row.severity,
      row.summary,
      row.details,
      row.affected_artifact,
      row.affected_row_ref,
      row.recommended_action,
    ])
  );
}

function buildUsSourceLinksCsvFile(rows: readonly TaxPackageSourceLinkRow[]): TaxPackageFile {
  return buildCsvFile(
    'source_links',
    'source-links.csv',
    'Audit traceability appendix linking package-local refs to source-system references.',
    [
      'package_ref',
      'package_artifact',
      'source_type',
      'source_venue_label',
      'source_account_label',
      'source_reference',
      'source_reference_kind',
      'source_url',
    ],
    rows.map((row) => [
      row.package_ref,
      row.package_artifact,
      row.source_type,
      row.source_venue_label,
      row.source_account_label,
      row.source_reference,
      row.source_reference_kind,
      row.source_url,
    ])
  );
}
