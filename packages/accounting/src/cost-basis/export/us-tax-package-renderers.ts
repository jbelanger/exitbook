import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { AcquisitionLot, LotDisposal, LotTransfer } from '../model/types.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import {
  appendSourceLinkRows,
  formatDate,
  formatMeasure,
  formatMoney,
  formatOptionalMoney,
  formatQuantity,
  formatSignedOptionalMoney,
  makeRef,
  requireTransaction,
  type TaxPackageSourceLinkRow,
} from './tax-package-builder-shared.js';

export interface UsLotRow {
  account_label: string;
  asset: string;
  cost_basis_per_unit: string;
  date_acquired: string;
  lot_ref: string;
  lot_status: 'fully_disposed' | 'open';
  origin_period: 'current_year' | 'prior_year';
  quantity_acquired: string;
  remaining_quantity: string;
  tax_currency: string;
  total_cost_basis: string;
}

export interface UsDispositionRow {
  account_label: string;
  asset: string;
  cost_basis: string;
  date_acquired: string;
  date_disposed: string;
  disposition_group: string;
  disposition_ref: string;
  form_8949_adjustment_amount: string;
  form_8949_adjustment_code: string;
  form_8949_box: UsForm8949Box;
  gain_loss: string;
  holding_period_days: string;
  lot_ref: string;
  net_proceeds: string;
  proceeds_gross: string;
  quantity_disposed: string;
  selling_expenses: string;
  tax_currency: string;
  tax_treatment: 'long_term' | 'short_term';
}

export interface UsTransferRow {
  asset: string;
  basis_source: 'fee_basis' | 'lot_carryover';
  cost_basis_carried: string;
  cost_basis_per_unit: string;
  date_transferred: string;
  quantity_transferred: string;
  source_account_label: string;
  source_lot_ref: string;
  target_account_label: string;
  tax_currency: string;
  transfer_direction: 'internal_transfer';
  transfer_ref: string;
  transfer_status: 'review_needed_inbound' | 'verified';
}

export interface UsRowRefMaps {
  dispositionRefById: Map<string, string>;
  dispositionGroupRefById: Map<string, string>;
  lotRefById: Map<string, string>;
  transferRefById: Map<string, string>;
}

interface DispositionRowContext {
  acquisitionDate: Date;
  asset: string;
  disposalAccountLabel: string;
  lotRef: string;
  taxTreatment: 'long_term' | 'short_term';
}

type UsForm8949Box = 'G' | 'J';

const US_DIGITAL_ASSET_FALLBACK_FORM_8949_BOX_BY_TREATMENT: Record<'long_term' | 'short_term', UsForm8949Box> = {
  short_term: 'G',
  long_term: 'J',
};

export function buildUsLotRows(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string) => string;
  context: TaxPackageBuildContext;
  rowRefMaps: UsRowRefMaps;
  workflowResult: Extract<TaxPackageBuildContext['workflowResult'], { kind: 'standard-workflow' }>;
}): Result<UsLotRow[], Error> {
  const sortedLots = [...params.workflowResult.lots].sort((left, right) =>
    compareLotsByDateAssetAndId(left, right, params.assetLabeler)
  );

  const rows: UsLotRow[] = [];
  for (const lot of sortedLots) {
    const transactionResult = requireTransaction(
      params.context,
      lot.acquisitionTransactionId,
      `standard lot ${lot.id}`
    );
    if (transactionResult.isErr()) {
      return err(transactionResult.error);
    }

    const accountLabelResult = params.accountLabeler(transactionResult.value.accountId);
    if (accountLabelResult.isErr()) {
      return err(accountLabelResult.error);
    }

    const lotRef = params.rowRefMaps.lotRefById.get(lot.id);
    if (!lotRef) {
      return err(new Error(`Missing lot_ref for lot ${lot.id}`));
    }

    rows.push({
      lot_ref: lotRef,
      asset: params.assetLabeler(lot.assetSymbol, lot.assetId),
      account_label: accountLabelResult.value,
      date_acquired: formatDate(lot.acquisitionDate),
      origin_period:
        lot.acquisitionDate.getUTCFullYear() < params.workflowResult.summary.calculation.config.taxYear
          ? 'prior_year'
          : 'current_year',
      quantity_acquired: formatQuantity(lot.quantity),
      cost_basis_per_unit: formatMeasure(lot.costBasisPerUnit),
      total_cost_basis: formatMoney(lot.totalCostBasis),
      remaining_quantity: formatQuantity(lot.remainingQuantity),
      lot_status: lot.status === 'fully_disposed' ? 'fully_disposed' : 'open',
      tax_currency: params.workflowResult.summary.calculation.config.currency,
    });
  }

  return ok(rows);
}

export function buildUsDispositionRows(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string) => string;
  context: TaxPackageBuildContext;
  rowRefMaps: UsRowRefMaps;
  workflowResult: Extract<TaxPackageBuildContext['workflowResult'], { kind: 'standard-workflow' }>;
}): Result<UsDispositionRow[], Error> {
  const lotsById = new Map(params.workflowResult.lots.map((lot) => [lot.id, lot] as const));
  const sortedDisposals = [...params.workflowResult.disposals].sort((left, right) =>
    compareDispositionsForExport(left, right, lotsById, params.assetLabeler)
  );

  const rows: UsDispositionRow[] = [];
  for (const disposal of sortedDisposals) {
    const rowContextResult = buildDispositionRowContext({
      context: params.context,
      lotsById,
      disposal,
      accountLabeler: params.accountLabeler,
      assetLabeler: params.assetLabeler,
      rowRefMaps: params.rowRefMaps,
    });
    if (rowContextResult.isErr()) {
      return err(rowContextResult.error);
    }

    const rowContext = rowContextResult.value;
    const dispositionRef = params.rowRefMaps.dispositionRefById.get(disposal.id);
    const dispositionGroup = params.rowRefMaps.dispositionGroupRefById.get(
      buildDispositionGroupKey(disposal, rowContext.asset)
    );
    if (!dispositionRef || !dispositionGroup) {
      return err(new Error(`Missing disposition refs for disposal ${disposal.id}`));
    }

    const adjustment = buildForm8949Adjustment(disposal);

    rows.push({
      disposition_ref: dispositionRef,
      disposition_group: dispositionGroup,
      asset: rowContext.asset,
      account_label: rowContext.disposalAccountLabel,
      date_disposed: formatDate(disposal.disposalDate),
      quantity_disposed: formatQuantity(disposal.quantityDisposed),
      proceeds_gross: formatMoney(disposal.grossProceeds),
      selling_expenses: formatOptionalMoney(disposal.sellingExpenses),
      net_proceeds: formatMoney(disposal.netProceeds),
      cost_basis: formatMoney(disposal.totalCostBasis),
      gain_loss: formatMoney(disposal.gainLoss),
      tax_currency: params.workflowResult.summary.calculation.config.currency,
      date_acquired: formatDate(rowContext.acquisitionDate),
      holding_period_days: String(disposal.holdingPeriodDays),
      tax_treatment: rowContext.taxTreatment,
      lot_ref: rowContext.lotRef,
      form_8949_box: deriveUsForm8949Box(rowContext.taxTreatment),
      form_8949_adjustment_code: adjustment.code,
      form_8949_adjustment_amount: adjustment.amount,
    });
  }

  return ok(rows);
}

export function buildUsTransferRows(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string) => string;
  context: TaxPackageBuildContext;
  rowRefMaps: UsRowRefMaps;
  workflowResult: Extract<TaxPackageBuildContext['workflowResult'], { kind: 'standard-workflow' }>;
}): Result<UsTransferRow[], Error> {
  const lotsById = new Map(params.workflowResult.lots.map((lot) => [lot.id, lot] as const));
  const sortedTransfers = [...params.workflowResult.lotTransfers].sort((left, right) => {
    const leftLot = lotsById.get(left.sourceLotId);
    const rightLot = lotsById.get(right.sourceLotId);
    if (!leftLot || !rightLot) {
      return left.id.localeCompare(right.id);
    }

    return compareTransferRows(left, right, leftLot, rightLot, params.assetLabeler);
  });

  const rows: UsTransferRow[] = [];
  for (const transfer of sortedTransfers) {
    const sourceLot = lotsById.get(transfer.sourceLotId);
    if (!sourceLot) {
      return err(new Error(`Missing source lot ${transfer.sourceLotId} for transfer ${transfer.id}`));
    }

    const sourceTransactionResult = requireTransaction(
      params.context,
      transfer.sourceTransactionId,
      `transfer ${transfer.id}`
    );
    if (sourceTransactionResult.isErr()) {
      return err(sourceTransactionResult.error);
    }
    const targetTransactionResult = requireTransaction(
      params.context,
      transfer.targetTransactionId,
      `transfer ${transfer.id}`
    );
    if (targetTransactionResult.isErr()) {
      return err(targetTransactionResult.error);
    }

    const sourceAccountLabelResult = params.accountLabeler(sourceTransactionResult.value.accountId);
    if (sourceAccountLabelResult.isErr()) {
      return err(sourceAccountLabelResult.error);
    }
    const targetAccountLabelResult = params.accountLabeler(targetTransactionResult.value.accountId);
    if (targetAccountLabelResult.isErr()) {
      return err(targetAccountLabelResult.error);
    }

    const transferRef = params.rowRefMaps.transferRefById.get(transfer.id);
    const sourceLotRef = params.rowRefMaps.lotRefById.get(transfer.sourceLotId);
    if (!transferRef || !sourceLotRef) {
      return err(new Error(`Missing package-local refs for transfer ${transfer.id}`));
    }

    const costBasisCarried = calculateTransferredBasisIncludingFees(transfer);
    const effectiveCostBasisPerUnit = transfer.quantityTransferred.isZero()
      ? transfer.costBasisPerUnit
      : costBasisCarried.dividedBy(transfer.quantityTransferred);

    rows.push({
      transfer_ref: transferRef,
      asset: params.assetLabeler(sourceLot.assetSymbol, sourceLot.assetId),
      date_transferred: formatDate(transfer.transferDate),
      transfer_status: deriveUsTransferStatus(transfer),
      transfer_direction: 'internal_transfer',
      source_account_label: sourceAccountLabelResult.value,
      target_account_label: targetAccountLabelResult.value,
      quantity_transferred: formatQuantity(transfer.quantityTransferred),
      cost_basis_carried: formatMoney(costBasisCarried),
      tax_currency: params.workflowResult.summary.calculation.config.currency,
      cost_basis_per_unit: formatMeasure(effectiveCostBasisPerUnit),
      basis_source: deriveUsTransferBasisSource(transfer),
      source_lot_ref: sourceLotRef,
    });
  }

  return ok(rows);
}

export function buildUsSourceLinkRows(params: {
  context: TaxPackageBuildContext;
  rowRefMaps: UsRowRefMaps;
  sourceNameCounts: Map<string, number>;
  workflowResult: Extract<TaxPackageBuildContext['workflowResult'], { kind: 'standard-workflow' }>;
}): Result<TaxPackageSourceLinkRow[], Error> {
  const rows: TaxPackageSourceLinkRow[] = [];
  const seen = new Set<string>();
  const lotsById = new Map(params.workflowResult.lots.map((lot) => [lot.id, lot] as const));

  for (const lot of params.workflowResult.lots) {
    const packageRef = params.rowRefMaps.lotRefById.get(lot.id);
    if (!packageRef) continue;
    const appendResult = appendSourceLinkRows(rows, seen, {
      context: params.context,
      packageArtifact: 'lots.csv',
      packageRef,
      sourceNameCounts: params.sourceNameCounts,
      transactionIds: [lot.acquisitionTransactionId],
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }
  }

  for (const disposal of params.workflowResult.disposals) {
    const packageRef = params.rowRefMaps.dispositionRefById.get(disposal.id);
    if (!packageRef) continue;

    const sourceLot = lotsById.get(disposal.lotId);
    if (!sourceLot) {
      return err(new Error(`Missing source lot ${disposal.lotId} for source-links disposal ${disposal.id}`));
    }

    const appendResult = appendSourceLinkRows(rows, seen, {
      context: params.context,
      packageArtifact: 'dispositions.csv',
      packageRef,
      sourceNameCounts: params.sourceNameCounts,
      transactionIds: [disposal.disposalTransactionId, sourceLot.acquisitionTransactionId],
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }
  }

  for (const transfer of params.workflowResult.lotTransfers) {
    const packageRef = params.rowRefMaps.transferRefById.get(transfer.id);
    if (!packageRef) continue;

    const appendResult = appendSourceLinkRows(rows, seen, {
      context: params.context,
      packageArtifact: 'transfers.csv',
      packageRef,
      sourceNameCounts: params.sourceNameCounts,
      transactionIds: [transfer.sourceTransactionId, transfer.targetTransactionId],
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

export function buildUsRowRefMaps(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string) => string;
  context: TaxPackageBuildContext;
  workflowResult: Extract<TaxPackageBuildContext['workflowResult'], { kind: 'standard-workflow' }>;
}): Result<UsRowRefMaps, Error> {
  const lotRefById = new Map<string, string>();
  const dispositionRefById = new Map<string, string>();
  const dispositionGroupRefById = new Map<string, string>();
  const transferRefById = new Map<string, string>();
  const lotsById = new Map(params.workflowResult.lots.map((lot) => [lot.id, lot] as const));

  [...params.workflowResult.lots]
    .sort((left, right) => compareLotsByDateAssetAndId(left, right, params.assetLabeler))
    .forEach((lot, index) => {
      lotRefById.set(lot.id, makeRef('LOT', index + 1));
    });

  const sortedDisposals = [...params.workflowResult.disposals].sort((left, right) =>
    compareDispositionsForExport(left, right, lotsById, params.assetLabeler)
  );
  const dispositionGroupIndexByKey = new Map<string, number>();
  for (const [index, disposal] of sortedDisposals.entries()) {
    const rowContextResult = buildDispositionRowContext({
      context: params.context,
      lotsById,
      disposal,
      accountLabeler: params.accountLabeler,
      assetLabeler: params.assetLabeler,
      rowRefMaps: { lotRefById },
    });
    if (rowContextResult.isErr()) {
      return err(rowContextResult.error);
    }

    const groupKey = buildDispositionGroupKey(disposal, rowContextResult.value.asset);
    const groupIndex = dispositionGroupIndexByKey.get(groupKey) ?? dispositionGroupIndexByKey.size + 1;
    dispositionGroupIndexByKey.set(groupKey, groupIndex);
    dispositionRefById.set(disposal.id, makeRef('DISP', index + 1));
    dispositionGroupRefById.set(groupKey, makeRef('DISP-GROUP', groupIndex));
  }

  [...params.workflowResult.lotTransfers]
    .sort((left, right) => {
      const leftLot = lotsById.get(left.sourceLotId);
      const rightLot = lotsById.get(right.sourceLotId);
      if (!leftLot || !rightLot) {
        return left.id.localeCompare(right.id);
      }

      return compareTransferRows(left, right, leftLot, rightLot, params.assetLabeler);
    })
    .forEach((transfer, index) => {
      transferRefById.set(transfer.id, makeRef('XFER', index + 1));
    });

  return ok({
    lotRefById,
    dispositionRefById,
    dispositionGroupRefById,
    transferRefById,
  });
}

export function buildUsAssetLabeler(
  workflowResult: Extract<TaxPackageBuildContext['workflowResult'], { kind: 'standard-workflow' }>
): (symbol: string, assetId: string) => string {
  const assetIdsBySymbol = new Map<string, Set<string>>();
  for (const lot of workflowResult.lots) {
    const assetIds = assetIdsBySymbol.get(lot.assetSymbol) ?? new Set<string>();
    assetIds.add(lot.assetId);
    assetIdsBySymbol.set(lot.assetSymbol, assetIds);
  }

  return (symbol: string, assetId: string) => {
    const assetIds = assetIdsBySymbol.get(symbol);
    if (!assetIds || assetIds.size <= 1) {
      return symbol;
    }

    return `${symbol} (${assetId})`;
  };
}

function buildDispositionRowContext(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string) => string;
  context: TaxPackageBuildContext;
  disposal: LotDisposal;
  lotsById: ReadonlyMap<string, AcquisitionLot>;
  rowRefMaps: Pick<UsRowRefMaps, 'lotRefById'>;
}): Result<DispositionRowContext, Error> {
  const sourceLot = params.lotsById.get(params.disposal.lotId);
  if (!sourceLot) {
    return err(new Error(`Missing source lot ${params.disposal.lotId} for disposal ${params.disposal.id}`));
  }

  const acquisitionTransactionResult = requireTransaction(
    params.context,
    sourceLot.acquisitionTransactionId,
    `standard lot ${sourceLot.id}`
  );
  if (acquisitionTransactionResult.isErr()) {
    return err(acquisitionTransactionResult.error);
  }
  const disposalTransactionResult = requireTransaction(
    params.context,
    params.disposal.disposalTransactionId,
    `standard disposal ${params.disposal.id}`
  );
  if (disposalTransactionResult.isErr()) {
    return err(disposalTransactionResult.error);
  }

  const acquisitionAccountLabelValidation = params.accountLabeler(acquisitionTransactionResult.value.accountId);
  if (acquisitionAccountLabelValidation.isErr()) {
    return err(acquisitionAccountLabelValidation.error);
  }
  const disposalAccountLabelResult = params.accountLabeler(disposalTransactionResult.value.accountId);
  if (disposalAccountLabelResult.isErr()) {
    return err(disposalAccountLabelResult.error);
  }

  const lotRef = params.rowRefMaps.lotRefById.get(sourceLot.id);
  if (!lotRef) {
    return err(new Error(`Missing lot_ref for lot ${sourceLot.id}`));
  }

  return ok({
    acquisitionDate: sourceLot.acquisitionDate,
    asset: params.assetLabeler(sourceLot.assetSymbol, sourceLot.assetId),
    disposalAccountLabel: disposalAccountLabelResult.value,
    lotRef,
    taxTreatment: normalizeTaxTreatmentCategory(params.disposal),
  });
}

function buildDispositionGroupKey(disposal: LotDisposal, assetLabel: string): string {
  return `${disposal.disposalTransactionId}|${assetLabel}`;
}

function compareLotsByDateAssetAndId(
  left: AcquisitionLot,
  right: AcquisitionLot,
  assetLabeler: (symbol: string, assetId: string) => string
): number {
  const dateDiff = left.acquisitionDate.getTime() - right.acquisitionDate.getTime();
  if (dateDiff !== 0) {
    return dateDiff;
  }

  const assetDiff = assetLabeler(left.assetSymbol, left.assetId).localeCompare(
    assetLabeler(right.assetSymbol, right.assetId)
  );
  if (assetDiff !== 0) {
    return assetDiff;
  }

  return left.id.localeCompare(right.id);
}

function compareDispositionsForExport(
  left: LotDisposal,
  right: LotDisposal,
  lotsById: ReadonlyMap<string, AcquisitionLot>,
  assetLabeler: (symbol: string, assetId: string) => string
): number {
  const treatmentDiff =
    taxTreatmentRank(normalizeTaxTreatmentCategory(left)) - taxTreatmentRank(normalizeTaxTreatmentCategory(right));
  if (treatmentDiff !== 0) {
    return treatmentDiff;
  }

  const dateDisposedDiff = left.disposalDate.getTime() - right.disposalDate.getTime();
  if (dateDisposedDiff !== 0) {
    return dateDisposedDiff;
  }

  const leftLot = lotsById.get(left.lotId);
  const rightLot = lotsById.get(right.lotId);
  if (leftLot && rightLot) {
    const dateAcquiredDiff = leftLot.acquisitionDate.getTime() - rightLot.acquisitionDate.getTime();
    if (dateAcquiredDiff !== 0) {
      return dateAcquiredDiff;
    }

    const assetDiff = assetLabeler(leftLot.assetSymbol, leftLot.assetId).localeCompare(
      assetLabeler(rightLot.assetSymbol, rightLot.assetId)
    );
    if (assetDiff !== 0) {
      return assetDiff;
    }
  }

  return left.id.localeCompare(right.id);
}

function compareTransferRows(
  left: LotTransfer,
  right: LotTransfer,
  leftLot: AcquisitionLot,
  rightLot: AcquisitionLot,
  assetLabeler: (symbol: string, assetId: string) => string
): number {
  const dateDiff = left.transferDate.getTime() - right.transferDate.getTime();
  if (dateDiff !== 0) {
    return dateDiff;
  }

  const assetDiff = assetLabeler(leftLot.assetSymbol, leftLot.assetId).localeCompare(
    assetLabeler(rightLot.assetSymbol, rightLot.assetId)
  );
  if (assetDiff !== 0) {
    return assetDiff;
  }

  return left.id.localeCompare(right.id);
}

function taxTreatmentRank(value: 'long_term' | 'short_term'): number {
  return value === 'short_term' ? 0 : 1;
}

function normalizeTaxTreatmentCategory(disposal: LotDisposal): 'long_term' | 'short_term' {
  if (disposal.taxTreatmentCategory === 'short_term' || disposal.taxTreatmentCategory === 'long_term') {
    return disposal.taxTreatmentCategory;
  }

  // Backward-compatibility fallback for older standard-workflow artifacts that
  // predate persisted taxTreatmentCategory. For the current US package contract,
  // >= 365 holding-period days is treated as long-term.
  return disposal.holdingPeriodDays >= 365 ? 'long_term' : 'short_term';
}

function buildForm8949Adjustment(disposal: LotDisposal): { amount: string; code: string } {
  const codes: string[] = [];
  let totalAdjustment = parseDecimal('0');

  if (disposal.lossDisallowed === true) {
    codes.push('W');
    totalAdjustment = totalAdjustment.plus(disposal.disallowedLossAmount ?? disposal.gainLoss.abs());
  }

  if (!disposal.sellingExpenses.isZero()) {
    codes.push('E');
    totalAdjustment = totalAdjustment.minus(disposal.sellingExpenses);
  }

  return {
    code: codes.join(','),
    amount: formatSignedOptionalMoney(totalAdjustment),
  };
}

function deriveUsForm8949Box(taxTreatment: 'long_term' | 'short_term'): UsForm8949Box {
  return US_DIGITAL_ASSET_FALLBACK_FORM_8949_BOX_BY_TREATMENT[taxTreatment];
}

function deriveUsTransferBasisSource(_transfer: LotTransfer): 'fee_basis' | 'lot_carryover' {
  return 'lot_carryover';
}

function deriveUsTransferStatus(transfer: LotTransfer): 'review_needed_inbound' | 'verified' {
  return transfer.provenance.kind === 'confirmed-link' ? 'verified' : 'review_needed_inbound';
}

function calculateTransferredBasisIncludingFees(transfer: LotTransfer): Decimal {
  const feeBasis = transfer.metadata?.sameAssetFeeUsdValue ?? parseDecimal('0');
  return transfer.costBasisPerUnit.times(transfer.quantityTransferred).plus(feeBasis);
}
