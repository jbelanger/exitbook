import type { Account, UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import { CANADA_CURRENT_CAPITAL_GAINS_INCLUSION_RATE } from '../jurisdictions/canada/tax/canada-policy.js';
import type {
  CanadaDispositionEvent,
  CanadaSuperficialLossAdjustment,
  CanadaTaxInputContext,
  CanadaTaxReport,
} from '../jurisdictions/canada/tax/canada-tax-types.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import { buildTaxPackageReportTemplate } from './tax-package-report-template.js';
import type {
  TaxPackageArtifactIndexEntry,
  TaxPackageBuildResult,
  TaxPackageFile,
  TaxPackageIssue,
  TaxPackageManifest,
  TaxPackageReadinessResult,
} from './tax-package-types.js';
import { TAX_PACKAGE_KIND, TAX_PACKAGE_VERSION } from './tax-package-types.js';

interface BuildCanadaTaxPackageParams {
  context: TaxPackageBuildContext;
  now: () => Date;
  readiness: TaxPackageReadinessResult;
}

interface CanadaAcquisitionRow {
  acquisition_ref: string;
  account_label: string;
  asset: string;
  cost_basis_per_unit: string;
  date_acquired: string;
  origin_period: 'current_year' | 'prior_year';
  quantity_acquired: string;
  remaining_acb: string;
  remaining_quantity: string;
  tax_currency: string;
  total_cost_basis: string;
}

interface CanadaDispositionRow {
  acb_per_unit: string;
  account_label: string;
  asset: string;
  cost_basis: string;
  date_disposed: string;
  denied_loss: string;
  disposition_group: string;
  disposition_ref: string;
  gain_loss: string;
  net_proceeds: string;
  proceeds_gross: string;
  quantity_disposed: string;
  selling_expenses: string;
  tax_currency: string;
  taxable_gain_loss: string;
}

interface CanadaTransferRow {
  asset: string;
  carried_acb_per_unit: string;
  cost_basis_carried: string;
  date_transferred: string;
  fee_acb_adjustment: string;
  quantity_transferred: string;
  source_account_label: string;
  target_account_label: string;
  tax_currency: string;
  transfer_direction: 'deposit' | 'internal_transfer' | 'withdrawal';
  transfer_ref: string;
  transfer_status: 'review_needed_inbound' | 'review_needed_outbound' | 'verified';
}

interface CanadaAdjustmentRow {
  adjustment_ref: string;
  asset: string;
  date_disposed: string;
  denied_loss: string;
  denied_quantity: string;
  related_disposition_ref: string;
  replacement_acquisition_date: string;
  substituted_acquisition_ref: string;
  tax_currency: string;
}

interface CanadaIssueRow {
  affected_artifact: string;
  affected_row_ref: string;
  code: string;
  details: string;
  issue_ref: string;
  recommended_action: string;
  severity: string;
  summary: string;
}

interface CanadaSourceLinkRow {
  package_artifact: string;
  package_ref: string;
  source_account_label: string;
  source_reference: string;
  source_reference_kind: string;
  source_type: string;
  source_url: string;
  source_venue_label: string;
}

interface RowRefMaps {
  acquisitionRefByEventId: Map<string, string>;
  dispositionRefByEventId: Map<string, string>;
  transferRefById: Map<string, string>;
}

function compareCanadaExportRowsByDateAssetAndId<T extends { assetSymbol: string; id: string; taxPropertyKey: string }>(
  left: T,
  right: T,
  getDate: (value: T) => Date,
  assetLabeler: (symbol: string, taxPropertyKey: string) => string
): number {
  const dateDiff = getDate(left).getTime() - getDate(right).getTime();
  if (dateDiff !== 0) {
    return dateDiff;
  }

  const assetDiff = assetLabeler(left.assetSymbol, left.taxPropertyKey).localeCompare(
    assetLabeler(right.assetSymbol, right.taxPropertyKey)
  );
  if (assetDiff !== 0) {
    return assetDiff;
  }

  return left.id.localeCompare(right.id);
}

export function buildCanadaTaxPackage(params: BuildCanadaTaxPackageParams): Result<TaxPackageBuildResult, Error> {
  if (params.context.workflowResult.kind !== 'canada-workflow') {
    return err(new Error('Canada tax package builder requires a canada-workflow artifact'));
  }

  const workflowResult = params.context.workflowResult;
  if (!workflowResult.inputContext) {
    return err(new Error('Canada tax package builder requires inputContext'));
  }

  const accountLabeler = buildAccountLabeler(params.context);
  const assetLabeler = buildAssetLabeler(workflowResult.taxReport, workflowResult.inputContext);
  const generatedAt = params.now();

  let supportingFiles: TaxPackageFile[];
  if (params.readiness.status === 'blocked') {
    supportingFiles = buildBlockedSupportingFiles(params.readiness);
  } else {
    const completeResult = buildCompleteSupportingFiles({
      accountLabeler,
      assetLabeler,
      context: params.context,
      inputContext: workflowResult.inputContext,
      readiness: params.readiness,
      taxReport: workflowResult.taxReport,
      taxYear: workflowResult.calculation.taxYear,
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
    context: params.context,
    generatedAt,
    readiness: params.readiness,
    taxReport: workflowResult.taxReport,
    artifactIndex,
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

function buildCompleteSupportingFiles(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, taxPropertyKey: string) => string;
  context: TaxPackageBuildContext;
  inputContext: CanadaTaxInputContext;
  readiness: TaxPackageReadinessResult;
  taxReport: CanadaTaxReport;
  taxYear: number;
}): Result<TaxPackageFile[], Error> {
  const rowRefMaps = buildRowRefMaps(params.taxReport, params.assetLabeler);
  const sourceNameCounts = countAccountsBySourceName(params.context);

  const acquisitionRowsResult = buildAcquisitionRows(
    params.taxReport,
    params.context,
    params.accountLabeler,
    params.assetLabeler,
    params.taxYear
  );
  if (acquisitionRowsResult.isErr()) {
    return err(acquisitionRowsResult.error);
  }

  const dispositionRowsResult = buildDispositionRows(
    params.taxReport,
    params.inputContext,
    params.context,
    params.accountLabeler,
    params.assetLabeler
  );
  if (dispositionRowsResult.isErr()) {
    return err(dispositionRowsResult.error);
  }

  const transferRowsResult = buildTransferRows(
    params.taxReport,
    params.context,
    params.accountLabeler,
    params.assetLabeler
  );
  if (transferRowsResult.isErr()) {
    return err(transferRowsResult.error);
  }

  const adjustmentRowsResult = buildAdjustmentRows(
    params.taxReport.superficialLossAdjustments,
    params.taxReport,
    rowRefMaps,
    params.assetLabeler
  );
  if (adjustmentRowsResult.isErr()) {
    return err(adjustmentRowsResult.error);
  }

  const issueRows = buildIssueRows(params.readiness.issues);
  const sourceLinkRowsResult = buildSourceLinkRows({
    context: params.context,
    rowRefMaps,
    sourceNameCounts,
    taxReport: params.taxReport,
  });
  if (sourceLinkRowsResult.isErr()) {
    return err(sourceLinkRowsResult.error);
  }

  const files: TaxPackageFile[] = [
    buildCsvFile(
      'dispositions',
      'dispositions.csv',
      'Primary filing-support table for Canada dispositions.',
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
        'acb_per_unit',
        'denied_loss',
        'taxable_gain_loss',
      ],
      dispositionRowsResult.value.map((row) => [
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
        row.acb_per_unit,
        row.denied_loss,
        row.taxable_gain_loss,
      ])
    ),
    buildCsvFile(
      'transfers',
      'transfers.csv',
      'Audit appendix for internal carryovers and transfer basis movement.',
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
        'carried_acb_per_unit',
        'fee_acb_adjustment',
      ],
      transferRowsResult.value.map((row) => [
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
        row.carried_acb_per_unit,
        row.fee_acb_adjustment,
      ])
    ),
    buildCsvFile(
      'acquisitions',
      'acquisitions.csv',
      'Canada ACB support appendix for acquisition layers used by the filing-year result.',
      [
        'acquisition_ref',
        'asset',
        'account_label',
        'date_acquired',
        'origin_period',
        'quantity_acquired',
        'total_cost_basis',
        'cost_basis_per_unit',
        'remaining_quantity',
        'remaining_acb',
        'tax_currency',
      ],
      acquisitionRowsResult.value.map((row) => [
        row.acquisition_ref,
        row.asset,
        row.account_label,
        row.date_acquired,
        row.origin_period,
        row.quantity_acquired,
        row.total_cost_basis,
        row.cost_basis_per_unit,
        row.remaining_quantity,
        row.remaining_acb,
        row.tax_currency,
      ])
    ),
  ];

  if (issueRows.length > 0) {
    files.push(
      buildCsvFile(
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
        issueRows.map((row) => [
          row.issue_ref,
          row.code,
          row.severity,
          row.summary,
          row.details,
          row.affected_artifact,
          row.affected_row_ref,
          row.recommended_action,
        ])
      )
    );
  }

  if (adjustmentRowsResult.value.length > 0) {
    files.push(
      buildCsvFile(
        'superficial_loss_adjustments',
        'superficial-loss-adjustments.csv',
        'Canada-only appendix for superficial-loss denials and substituted acquisitions.',
        [
          'adjustment_ref',
          'asset',
          'date_disposed',
          'replacement_acquisition_date',
          'denied_loss',
          'denied_quantity',
          'related_disposition_ref',
          'substituted_acquisition_ref',
          'tax_currency',
        ],
        adjustmentRowsResult.value.map((row) => [
          row.adjustment_ref,
          row.asset,
          row.date_disposed,
          row.replacement_acquisition_date,
          row.denied_loss,
          row.denied_quantity,
          row.related_disposition_ref,
          row.substituted_acquisition_ref,
          row.tax_currency,
        ])
      )
    );
  }

  if (sourceLinkRowsResult.value.length > 0) {
    files.push(
      buildCsvFile(
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
        sourceLinkRowsResult.value.map((row) => [
          row.package_ref,
          row.package_artifact,
          row.source_type,
          row.source_venue_label,
          row.source_account_label,
          row.source_reference,
          row.source_reference_kind,
          row.source_url,
        ])
      )
    );
  }

  return ok(files);
}

function buildBlockedSupportingFiles(readiness: TaxPackageReadinessResult): TaxPackageFile[] {
  if (readiness.issues.length === 0) {
    return [];
  }

  const issueRows = buildIssueRows(readiness.issues);
  return [
    buildCsvFile(
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
      issueRows.map((row) => [
        row.issue_ref,
        row.code,
        row.severity,
        row.summary,
        row.details,
        row.affected_artifact,
        row.affected_row_ref,
        row.recommended_action,
      ])
    ),
  ];
}

function buildManifest(params: {
  artifactIndex: readonly TaxPackageArtifactIndexEntry[];
  context: TaxPackageBuildContext;
  generatedAt: Date;
  readiness: TaxPackageReadinessResult;
  taxReport: CanadaTaxReport;
}): TaxPackageManifest {
  return {
    packageKind: TAX_PACKAGE_KIND,
    packageVersion: TAX_PACKAGE_VERSION,
    packageStatus: params.readiness.status,
    jurisdiction: 'CA',
    taxYear:
      params.context.workflowResult.kind === 'canada-workflow' ? params.context.workflowResult.calculation.taxYear : 0,
    calculationId: params.context.artifactRef.calculationId,
    snapshotId: params.context.artifactRef.snapshotId,
    scopeKey: params.context.artifactRef.scopeKey,
    generatedAt: params.generatedAt.toISOString(),
    method: 'average-cost',
    taxCurrency: params.taxReport.taxCurrency,
    summaryTotals: {
      totalProceeds: formatMoney(params.taxReport.summary.totalProceedsCad),
      totalCostBasis: formatMoney(params.taxReport.summary.totalCostBasisCad),
      totalGainLoss: formatMoney(params.taxReport.summary.totalGainLossCad),
      totalTaxableGainLoss: formatMoney(params.taxReport.summary.totalTaxableGainLossCad),
    },
    reviewItems: params.readiness.reviewItems,
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
    title: 'Canada Cost Basis Tax Package',
    generatedAt: params.generatedAt,
    manifest: params.manifest,
    blockingIssues: params.readiness.blockingIssues,
    reviewItems: params.readiness.reviewItems,
    fileDescriptions: params.manifest.artifactIndex.map((item) => ({
      name: item.relativePath,
      purpose: item.purpose,
    })),
    filingNotes: [
      `The package applies a Canada capital-gains inclusion rate of ${trimTrailingZeros(CANADA_CURRENT_CAPITAL_GAINS_INCLUSION_RATE.toFixed())}.`,
      'dispositions.csv uses gross proceeds, selling expenses, and net proceeds so the Canada gain/loss formula is explicit.',
      'acquisitions.csv is a pooled ACB support appendix, not a running transaction ledger.',
    ],
  });
}

function buildAcquisitionRows(
  taxReport: CanadaTaxReport,
  context: TaxPackageBuildContext,
  accountLabeler: (accountId: number) => Result<string, Error>,
  assetLabeler: (symbol: string, taxPropertyKey: string) => string,
  taxYear: number
): Result<CanadaAcquisitionRow[], Error> {
  const sorted = [...taxReport.acquisitions].sort((left, right) =>
    compareCanadaExportRowsByDateAssetAndId(left, right, (value) => value.acquiredAt, assetLabeler)
  );

  const rows: CanadaAcquisitionRow[] = [];
  for (const [index, acquisition] of sorted.entries()) {
    const transactionResult = requireTransaction(
      context,
      acquisition.transactionId,
      `Canada acquisition ${acquisition.id}`
    );
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }

    const accountLabelResult = accountLabeler(transactionResult.value.accountId);
    if (accountLabelResult.isErr()) {
      return err(accountLabelResult.error);
    }

    rows.push({
      acquisition_ref: makeRef('ACQ', index + 1),
      asset: assetLabeler(acquisition.assetSymbol, acquisition.taxPropertyKey),
      account_label: accountLabelResult.value,
      date_acquired: formatDate(acquisition.acquiredAt),
      origin_period: acquisition.acquiredAt.getUTCFullYear() < taxYear ? 'prior_year' : 'current_year',
      quantity_acquired: formatQuantity(acquisition.quantityAcquired),
      total_cost_basis: formatMoney(acquisition.totalCostCad),
      cost_basis_per_unit: formatMeasure(acquisition.costBasisPerUnitCad),
      remaining_quantity: formatQuantity(acquisition.remainingQuantity),
      remaining_acb: formatMoney(acquisition.remainingAllocatedAcbCad),
      tax_currency: taxReport.taxCurrency,
    });
  }

  return ok(rows);
}

function buildDispositionRows(
  taxReport: CanadaTaxReport,
  inputContext: CanadaTaxInputContext,
  context: TaxPackageBuildContext,
  accountLabeler: (accountId: number) => Result<string, Error>,
  assetLabeler: (symbol: string, taxPropertyKey: string) => string
): Result<CanadaDispositionRow[], Error> {
  const dispositionEventsById = new Map(
    inputContext.inputEvents
      .filter((event): event is CanadaDispositionEvent => event.kind === 'disposition')
      .map((event) => [event.eventId, event] as const)
  );

  const sorted = [...taxReport.dispositions].sort((left, right) =>
    compareCanadaExportRowsByDateAssetAndId(left, right, (value) => value.disposedAt, assetLabeler)
  );

  const rows: CanadaDispositionRow[] = [];
  for (const [index, disposition] of sorted.entries()) {
    const event = dispositionEventsById.get(disposition.dispositionEventId);
    if (!event) {
      return err(new Error(`Missing Canada disposition input event ${disposition.dispositionEventId}`));
    }

    const transactionResult = requireTransaction(
      context,
      disposition.transactionId,
      `Canada disposition ${disposition.id}`
    );
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }

    const accountLabelResult = accountLabeler(transactionResult.value.accountId);
    if (accountLabelResult.isErr()) {
      return err(accountLabelResult.error);
    }

    const sellingExpenses = event.proceedsReductionCad ?? event.valuation.totalValueCad.minus(disposition.proceedsCad);
    const grossProceeds = disposition.proceedsCad.plus(sellingExpenses);

    rows.push({
      disposition_ref: makeRef('DISP', index + 1),
      disposition_group: makeRef('DISP-GROUP', index + 1),
      asset: assetLabeler(disposition.assetSymbol, disposition.taxPropertyKey),
      account_label: accountLabelResult.value,
      date_disposed: formatDate(disposition.disposedAt),
      quantity_disposed: formatQuantity(disposition.quantityDisposed),
      proceeds_gross: formatMoney(grossProceeds),
      selling_expenses: formatOptionalMoney(sellingExpenses),
      net_proceeds: formatMoney(disposition.proceedsCad),
      cost_basis: formatMoney(disposition.costBasisCad),
      gain_loss: formatMoney(disposition.gainLossCad),
      tax_currency: taxReport.taxCurrency,
      acb_per_unit: formatMeasure(disposition.acbPerUnitCad),
      denied_loss: formatOptionalMoney(disposition.deniedLossCad),
      taxable_gain_loss: formatMoney(disposition.taxableGainLossCad),
    });
  }

  return ok(rows);
}

function buildTransferRows(
  taxReport: CanadaTaxReport,
  context: TaxPackageBuildContext,
  accountLabeler: (accountId: number) => Result<string, Error>,
  assetLabeler: (symbol: string, taxPropertyKey: string) => string
): Result<CanadaTransferRow[], Error> {
  const sorted = [...taxReport.transfers].sort((left, right) =>
    compareCanadaExportRowsByDateAssetAndId(left, right, (value) => value.transferredAt, assetLabeler)
  );

  const rows: CanadaTransferRow[] = [];
  for (const [index, transfer] of sorted.entries()) {
    const sourceAccountLabelResult = resolveOptionalAccountLabel(context, transfer.sourceTransactionId, accountLabeler);
    if (sourceAccountLabelResult.isErr()) {
      return err(sourceAccountLabelResult.error);
    }

    const targetAccountLabelResult = resolveOptionalAccountLabel(context, transfer.targetTransactionId, accountLabeler);
    if (targetAccountLabelResult.isErr()) {
      return err(targetAccountLabelResult.error);
    }

    rows.push({
      transfer_ref: makeRef('XFER', index + 1),
      asset: assetLabeler(transfer.assetSymbol, transfer.taxPropertyKey),
      date_transferred: formatDate(transfer.transferredAt),
      transfer_status:
        transfer.linkId !== undefined &&
        transfer.sourceTransactionId !== undefined &&
        transfer.targetTransactionId !== undefined
          ? 'verified'
          : transfer.direction === 'out'
            ? 'review_needed_outbound'
            : 'review_needed_inbound',
      transfer_direction:
        transfer.direction === 'in' ? 'deposit' : transfer.direction === 'out' ? 'withdrawal' : 'internal_transfer',
      source_account_label: sourceAccountLabelResult.value,
      target_account_label: targetAccountLabelResult.value,
      quantity_transferred: formatQuantity(transfer.quantity),
      cost_basis_carried: formatMoney(transfer.carriedAcbCad),
      tax_currency: taxReport.taxCurrency,
      carried_acb_per_unit: formatMeasure(transfer.carriedAcbPerUnitCad),
      fee_acb_adjustment: formatOptionalMoney(transfer.feeAdjustmentCad),
    });
  }

  return ok(rows);
}

function buildAdjustmentRows(
  adjustments: readonly CanadaSuperficialLossAdjustment[],
  taxReport: CanadaTaxReport,
  rowRefMaps: RowRefMaps,
  assetLabeler: (symbol: string, taxPropertyKey: string) => string
): Result<CanadaAdjustmentRow[], Error> {
  const acquisitionByEventId = new Map(
    taxReport.acquisitions.map((acquisition) => [acquisition.acquisitionEventId, acquisition] as const)
  );
  const dispositionByEventId = new Map(
    taxReport.dispositions.map((disposition) => [disposition.dispositionEventId, disposition] as const)
  );

  const sorted = [...adjustments].sort((left, right) =>
    compareCanadaExportRowsByDateAssetAndId(left, right, (value) => value.adjustedAt, assetLabeler)
  );

  const rows: CanadaAdjustmentRow[] = [];
  for (const [index, adjustment] of sorted.entries()) {
    const relatedDisposition = dispositionByEventId.get(adjustment.relatedDispositionId);
    if (!relatedDisposition) {
      return err(
        new Error(
          `Missing related disposition ${adjustment.relatedDispositionId} for superficial-loss adjustment ${adjustment.id}`
        )
      );
    }

    const substitutedAcquisition = acquisitionByEventId.get(adjustment.substitutedPropertyAcquisitionId);
    if (!substitutedAcquisition) {
      return err(
        new Error(
          `Missing substituted acquisition ${adjustment.substitutedPropertyAcquisitionId} for superficial-loss adjustment ${adjustment.id}`
        )
      );
    }

    const relatedDispositionRef = rowRefMaps.dispositionRefByEventId.get(adjustment.relatedDispositionId);
    const substitutedAcquisitionRef = rowRefMaps.acquisitionRefByEventId.get(
      adjustment.substitutedPropertyAcquisitionId
    );
    if (!relatedDispositionRef || !substitutedAcquisitionRef) {
      return err(new Error(`Missing package-local row ref for superficial-loss adjustment ${adjustment.id}`));
    }

    rows.push({
      adjustment_ref: makeRef('SLA', index + 1),
      asset: assetLabeler(adjustment.assetSymbol, adjustment.taxPropertyKey),
      date_disposed: formatDate(relatedDisposition.disposedAt),
      replacement_acquisition_date: formatDate(substitutedAcquisition.acquiredAt),
      denied_loss: formatMoney(adjustment.deniedLossCad),
      denied_quantity: formatQuantity(adjustment.deniedQuantity),
      related_disposition_ref: relatedDispositionRef,
      substituted_acquisition_ref: substitutedAcquisitionRef,
      tax_currency: taxReport.taxCurrency,
    });
  }

  return ok(rows);
}

function buildIssueRows(issues: readonly TaxPackageIssue[]): CanadaIssueRow[] {
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
    recommended_action: issue.recommendedAction ?? defaultRecommendedAction(issue.code),
  }));
}

function buildSourceLinkRows(params: {
  context: TaxPackageBuildContext;
  rowRefMaps: RowRefMaps;
  sourceNameCounts: Map<string, number>;
  taxReport: CanadaTaxReport;
}): Result<CanadaSourceLinkRow[], Error> {
  const rows: CanadaSourceLinkRow[] = [];
  const seen = new Set<string>();

  for (const acquisition of params.taxReport.acquisitions) {
    const packageRef = params.rowRefMaps.acquisitionRefByEventId.get(acquisition.acquisitionEventId);
    if (!packageRef) continue;
    const appendResult = appendSourceLinkRows(rows, seen, {
      context: params.context,
      packageArtifact: 'acquisitions.csv',
      packageRef,
      sourceNameCounts: params.sourceNameCounts,
      transactionIds: [acquisition.transactionId],
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }
  }

  for (const disposition of params.taxReport.dispositions) {
    const packageRef = params.rowRefMaps.dispositionRefByEventId.get(disposition.dispositionEventId);
    if (!packageRef) continue;
    const appendResult = appendSourceLinkRows(rows, seen, {
      context: params.context,
      packageArtifact: 'dispositions.csv',
      packageRef,
      sourceNameCounts: params.sourceNameCounts,
      transactionIds: [disposition.transactionId],
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }
  }

  for (const transfer of params.taxReport.transfers) {
    const packageRef = params.rowRefMaps.transferRefById.get(transfer.id);
    if (!packageRef) continue;
    const appendResult = appendSourceLinkRows(rows, seen, {
      context: params.context,
      packageArtifact: 'transfers.csv',
      packageRef,
      sourceNameCounts: params.sourceNameCounts,
      transactionIds: [transfer.sourceTransactionId, transfer.targetTransactionId, transfer.transactionId].filter(
        (id): id is number => id !== undefined
      ),
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }
  }

  rows.sort((left, right) => {
    const artifactDiff = left.package_artifact.localeCompare(right.package_artifact);
    if (artifactDiff !== 0) return artifactDiff;
    const packageRefDiff = left.package_ref.localeCompare(right.package_ref);
    if (packageRefDiff !== 0) return packageRefDiff;
    return left.source_reference.localeCompare(right.source_reference);
  });

  return ok(rows);
}

function appendSourceLinkRows(
  target: CanadaSourceLinkRow[],
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

    const sourceReference = getSourceReference(transactionResult.value);
    if (!sourceReference) {
      continue;
    }

    const account = params.context.sourceContext.accountsById.get(transactionResult.value.accountId);
    if (!account) {
      return err(
        new Error(`Missing account ${transactionResult.value.accountId} for transaction ${transactionResult.value.id}`)
      );
    }

    const row: CanadaSourceLinkRow = {
      package_ref: params.packageRef,
      package_artifact: params.packageArtifact,
      source_type: transactionResult.value.sourceType,
      source_venue_label: transactionResult.value.source,
      source_account_label: formatAccountLabel(account, params.sourceNameCounts.get(account.sourceName) ?? 0),
      source_reference: sourceReference.value,
      source_reference_kind: sourceReference.kind,
      source_url: '',
    };

    const dedupeKey = [
      row.package_ref,
      row.package_artifact,
      row.source_type,
      row.source_venue_label,
      row.source_account_label,
      row.source_reference,
      row.source_reference_kind,
    ].join('|');
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    target.push(row);
  }

  return ok(undefined);
}

function buildRowRefMaps(
  taxReport: CanadaTaxReport,
  assetLabeler: (symbol: string, taxPropertyKey: string) => string
): RowRefMaps {
  const acquisitionRefByEventId = new Map<string, string>();
  const dispositionRefByEventId = new Map<string, string>();
  const transferRefById = new Map<string, string>();

  [...taxReport.acquisitions]
    .sort((left, right) =>
      compareCanadaExportRowsByDateAssetAndId(left, right, (value) => value.acquiredAt, assetLabeler)
    )
    .forEach((acquisition, index) => {
      acquisitionRefByEventId.set(acquisition.acquisitionEventId, makeRef('ACQ', index + 1));
    });

  [...taxReport.dispositions]
    .sort((left, right) =>
      compareCanadaExportRowsByDateAssetAndId(left, right, (value) => value.disposedAt, assetLabeler)
    )
    .forEach((disposition, index) => {
      dispositionRefByEventId.set(disposition.dispositionEventId, makeRef('DISP', index + 1));
    });

  [...taxReport.transfers]
    .sort((left, right) =>
      compareCanadaExportRowsByDateAssetAndId(left, right, (value) => value.transferredAt, assetLabeler)
    )
    .forEach((transfer, index) => {
      transferRefById.set(transfer.id, makeRef('XFER', index + 1));
    });

  return {
    acquisitionRefByEventId,
    dispositionRefByEventId,
    transferRefById,
  };
}

function buildAccountLabeler(context: TaxPackageBuildContext): (accountId: number) => Result<string, Error> {
  const sourceNameCounts = countAccountsBySourceName(context);
  return (accountId: number) => {
    const account = context.sourceContext.accountsById.get(accountId);
    if (!account) {
      return err(new Error(`Missing account ${accountId} while rendering tax package`));
    }

    return ok(formatAccountLabel(account, sourceNameCounts.get(account.sourceName) ?? 0));
  };
}

function countAccountsBySourceName(context: TaxPackageBuildContext): Map<string, number> {
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

function buildAssetLabeler(
  taxReport: CanadaTaxReport,
  inputContext: CanadaTaxInputContext
): (symbol: string, taxPropertyKey: string) => string {
  const taxKeysBySymbol = new Map<string, Set<string>>();

  const register = (symbol: string, taxPropertyKey: string) => {
    const taxKeys = taxKeysBySymbol.get(symbol) ?? new Set<string>();
    taxKeys.add(taxPropertyKey);
    taxKeysBySymbol.set(symbol, taxKeys);
  };

  for (const acquisition of taxReport.acquisitions) {
    register(acquisition.assetSymbol, acquisition.taxPropertyKey);
  }
  for (const disposition of taxReport.dispositions) {
    register(disposition.assetSymbol, disposition.taxPropertyKey);
  }
  for (const transfer of taxReport.transfers) {
    register(transfer.assetSymbol, transfer.taxPropertyKey);
  }
  for (const adjustment of taxReport.superficialLossAdjustments) {
    register(adjustment.assetSymbol, adjustment.taxPropertyKey);
  }
  for (const event of inputContext.inputEvents) {
    register(event.assetSymbol, event.taxPropertyKey);
  }

  return (symbol: string, taxPropertyKey: string) => {
    const taxKeys = taxKeysBySymbol.get(symbol);
    if (!taxKeys || taxKeys.size <= 1) {
      return symbol;
    }

    return `${symbol} (${taxPropertyKey})`;
  };
}

function requireTransaction(
  context: TaxPackageBuildContext,
  transactionId: number,
  reference: string
): Result<UniversalTransactionData, Error> {
  const transaction = context.sourceContext.transactionsById.get(transactionId);
  if (!transaction) {
    return err(new Error(`Missing source transaction ${transactionId} for ${reference}`));
  }

  return ok(transaction);
}

function resolveOptionalAccountLabel(
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

function buildArtifactIndex(
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

function buildCsvFile(
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

function countCsvRows(file: TaxPackageFile): number | undefined {
  if (file.mediaType !== 'text/csv') {
    return undefined;
  }

  return Math.max(0, file.content.trimEnd().split('\n').length - 1);
}

function makeRef(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(4, '0')}`;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatMoney(value: Decimal): string {
  return value.toFixed(2);
}

function formatOptionalMoney(value: Decimal): string {
  return value.isZero() ? '' : formatMoney(value);
}

function formatQuantity(value: Decimal): string {
  return trimTrailingZeros(value.toFixed());
}

function formatMeasure(value: Decimal): string {
  return trimTrailingZeros(value.toFixed());
}

function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) {
    return value;
  }

  return value.replace(/\.?0+$/, '');
}

function severityRank(severity: string): number {
  return severity === 'blocked' ? 0 : 1;
}

function defaultRecommendedAction(code: TaxPackageIssue['code']): string {
  switch (code) {
    case 'MISSING_PRICE_DATA':
      return 'Enrich or set the missing prices, then rerun the package export.';
    case 'FX_FALLBACK_USED':
      return 'Review the FX conversions and confirm the fallback treatment is acceptable.';
    case 'UNRESOLVED_ASSET_REVIEW':
      return 'Resolve the pending asset reviews before using this package for filing.';
    case 'UNKNOWN_TRANSACTION_CLASSIFICATION':
      return 'Review and classify the affected transactions before filing.';
    case 'INCOMPLETE_TRANSFER_LINKING':
      return 'Review the affected transfer rows and confirm the internal carryover treatment.';
  }

  return 'Review the affected package rows before filing.';
}

function getSourceReference(transaction: UniversalTransactionData): { kind: string; value: string } | undefined {
  if (transaction.blockchain?.transaction_hash) {
    return {
      kind: 'blockchain_tx_hash',
      value: transaction.blockchain.transaction_hash,
    };
  }

  if (transaction.sourceType === 'exchange' && transaction.externalId) {
    return {
      kind: 'exchange_transaction_id',
      value: transaction.externalId,
    };
  }

  if (transaction.externalId) {
    return {
      kind: 'internal_reference',
      value: transaction.externalId,
    };
  }

  return undefined;
}
