import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type {
  StandardCostBasisAcquisitionFilingFact,
  StandardCostBasisDispositionFilingFact,
  StandardCostBasisFilingFacts,
  StandardCostBasisTransferFilingFact,
} from '../filing-facts/filing-facts-types.js';

import type { TaxPackageBuildContext } from './tax-package-build-context.js';
import {
  appendSourceLinkRows,
  formatDate,
  formatMeasure,
  formatMoney,
  formatOptionalMoney,
  formatQuantity,
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

export function buildUsLotRows(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string | undefined) => string;
  context: TaxPackageBuildContext;
  filingFacts: StandardCostBasisFilingFacts;
  rowRefMaps: UsRowRefMaps;
}): Result<UsLotRow[], Error> {
  const sortedLots = [...params.filingFacts.acquisitions].sort((left, right) =>
    compareLotsByDateAssetAndId(left, right, params.assetLabeler)
  );

  const rows: UsLotRow[] = [];
  for (const lot of sortedLots) {
    const transactionResult = requireTransaction(params.context, lot.transactionId, `standard lot ${lot.id}`);
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
      date_acquired: formatDate(lot.acquiredAt),
      origin_period: lot.acquiredAt.getUTCFullYear() < params.filingFacts.taxYear ? 'prior_year' : 'current_year',
      quantity_acquired: formatQuantity(lot.quantity),
      cost_basis_per_unit: formatMeasure(lot.costBasisPerUnit),
      total_cost_basis: formatMoney(lot.totalCostBasis),
      remaining_quantity: formatQuantity(lot.remainingQuantity),
      lot_status: lot.status === 'fully_disposed' ? 'fully_disposed' : 'open',
      tax_currency: params.filingFacts.taxCurrency,
    });
  }

  return ok(rows);
}

export function buildUsDispositionRows(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string | undefined) => string;
  context: TaxPackageBuildContext;
  filingFacts: StandardCostBasisFilingFacts;
  rowRefMaps: UsRowRefMaps;
}): Result<UsDispositionRow[], Error> {
  const sortedDisposals = [...params.filingFacts.dispositions].sort((left, right) =>
    compareDispositionsForExport(left, right, params.assetLabeler)
  );

  const rows: UsDispositionRow[] = [];
  for (const disposal of sortedDisposals) {
    const rowContextResult = buildDispositionRowContext({
      accountLabeler: params.accountLabeler,
      assetLabeler: params.assetLabeler,
      context: params.context,
      disposal,
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

    rows.push({
      disposition_ref: dispositionRef,
      disposition_group: dispositionGroup,
      asset: rowContext.asset,
      account_label: rowContext.disposalAccountLabel,
      date_disposed: formatDate(disposal.disposedAt),
      quantity_disposed: formatQuantity(disposal.quantity),
      proceeds_gross: formatMoney(disposal.grossProceeds),
      selling_expenses: formatOptionalMoney(disposal.sellingExpenses),
      net_proceeds: formatMoney(disposal.netProceeds),
      cost_basis: formatMoney(disposal.totalCostBasis),
      gain_loss: formatMoney(disposal.gainLoss),
      tax_currency: params.filingFacts.taxCurrency,
      date_acquired: formatDate(rowContext.acquisitionDate),
      holding_period_days: String(disposal.holdingPeriodDays),
      tax_treatment: rowContext.taxTreatment,
      lot_ref: rowContext.lotRef,
    });
  }

  return ok(rows);
}

export function buildUsTransferRows(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string | undefined) => string;
  context: TaxPackageBuildContext;
  filingFacts: StandardCostBasisFilingFacts;
  rowRefMaps: UsRowRefMaps;
}): Result<UsTransferRow[], Error> {
  const sortedTransfers = [...params.filingFacts.transfers].sort((left, right) =>
    compareTransferRows(left, right, params.assetLabeler)
  );

  const rows: UsTransferRow[] = [];
  for (const transfer of sortedTransfers) {
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
    const effectiveCostBasisPerUnit = transfer.quantity.isZero()
      ? transfer.costBasisPerUnit
      : costBasisCarried.dividedBy(transfer.quantity);

    rows.push({
      transfer_ref: transferRef,
      asset: params.assetLabeler(transfer.assetSymbol, transfer.assetId),
      date_transferred: formatDate(transfer.transferredAt),
      transfer_status: deriveUsTransferStatus(transfer),
      transfer_direction: 'internal_transfer',
      source_account_label: sourceAccountLabelResult.value,
      target_account_label: targetAccountLabelResult.value,
      quantity_transferred: formatQuantity(transfer.quantity),
      cost_basis_carried: formatMoney(costBasisCarried),
      tax_currency: params.filingFacts.taxCurrency,
      cost_basis_per_unit: formatMeasure(effectiveCostBasisPerUnit),
      basis_source: deriveUsTransferBasisSource(transfer),
      source_lot_ref: sourceLotRef,
    });
  }

  return ok(rows);
}

export function buildUsSourceLinkRows(params: {
  context: TaxPackageBuildContext;
  filingFacts: StandardCostBasisFilingFacts;
  rowRefMaps: UsRowRefMaps;
  sourceNameCounts: Map<string, number>;
}): Result<TaxPackageSourceLinkRow[], Error> {
  const rows: TaxPackageSourceLinkRow[] = [];
  const seen = new Set<string>();

  for (const lot of params.filingFacts.acquisitions) {
    const packageRef = params.rowRefMaps.lotRefById.get(lot.id);
    if (!packageRef) continue;
    const appendResult = appendSourceLinkRows(rows, seen, {
      context: params.context,
      packageArtifact: 'lots.csv',
      packageRef,
      sourceNameCounts: params.sourceNameCounts,
      transactionIds: [lot.transactionId],
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }
  }

  for (const disposal of params.filingFacts.dispositions) {
    const packageRef = params.rowRefMaps.dispositionRefById.get(disposal.id);
    if (!packageRef) continue;

    const appendResult = appendSourceLinkRows(rows, seen, {
      context: params.context,
      packageArtifact: 'dispositions.csv',
      packageRef,
      sourceNameCounts: params.sourceNameCounts,
      transactionIds: [disposal.disposalTransactionId, disposal.acquisitionTransactionId],
    });
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }
  }

  for (const transfer of params.filingFacts.transfers) {
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
  assetLabeler: (symbol: string, assetId: string | undefined) => string;
  context: TaxPackageBuildContext;
  filingFacts: StandardCostBasisFilingFacts;
}): Result<UsRowRefMaps, Error> {
  const lotRefById = new Map<string, string>();
  const dispositionRefById = new Map<string, string>();
  const dispositionGroupRefById = new Map<string, string>();
  const transferRefById = new Map<string, string>();

  [...params.filingFacts.acquisitions]
    .sort((left, right) => compareLotsByDateAssetAndId(left, right, params.assetLabeler))
    .forEach((lot, index) => {
      lotRefById.set(lot.id, makeRef('LOT', index + 1));
    });

  const sortedDisposals = [...params.filingFacts.dispositions].sort((left, right) =>
    compareDispositionsForExport(left, right, params.assetLabeler)
  );
  const dispositionGroupIndexByKey = new Map<string, number>();
  for (const [index, disposal] of sortedDisposals.entries()) {
    const rowContextResult = buildDispositionRowContext({
      accountLabeler: params.accountLabeler,
      assetLabeler: params.assetLabeler,
      context: params.context,
      disposal,
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

  [...params.filingFacts.transfers]
    .sort((left, right) => compareTransferRows(left, right, params.assetLabeler))
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
  filingFacts: StandardCostBasisFilingFacts
): (symbol: string, assetId: string | undefined) => string {
  const assetIdsBySymbol = new Map<string, Set<string>>();
  const register = (symbol: string, assetId: string | undefined) => {
    if (!assetId) {
      return;
    }

    const assetIds = assetIdsBySymbol.get(symbol) ?? new Set<string>();
    assetIds.add(assetId);
    assetIdsBySymbol.set(symbol, assetIds);
  };

  for (const lot of filingFacts.acquisitions) {
    register(lot.assetSymbol, lot.assetId);
  }
  for (const disposal of filingFacts.dispositions) {
    register(disposal.assetSymbol, disposal.assetId);
  }
  for (const transfer of filingFacts.transfers) {
    register(transfer.assetSymbol, transfer.assetId);
  }

  return (symbol: string, assetId: string | undefined) => {
    const assetIds = assetIdsBySymbol.get(symbol);
    if (!assetId || !assetIds || assetIds.size <= 1) {
      return symbol;
    }

    return `${symbol} (${assetId})`;
  };
}

function buildDispositionRowContext(params: {
  accountLabeler: (accountId: number) => Result<string, Error>;
  assetLabeler: (symbol: string, assetId: string | undefined) => string;
  context: TaxPackageBuildContext;
  disposal: StandardCostBasisDispositionFilingFact;
  rowRefMaps: Pick<UsRowRefMaps, 'lotRefById'>;
}): Result<DispositionRowContext, Error> {
  const acquisitionTransactionResult = requireTransaction(
    params.context,
    params.disposal.acquisitionTransactionId,
    `standard lot ${params.disposal.lotId}`
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

  const disposalAccountLabelResult = params.accountLabeler(disposalTransactionResult.value.accountId);
  if (disposalAccountLabelResult.isErr()) {
    return err(disposalAccountLabelResult.error);
  }

  const lotRef = params.rowRefMaps.lotRefById.get(params.disposal.lotId);
  if (!lotRef) {
    return err(new Error(`Missing lot_ref for lot ${params.disposal.lotId}`));
  }

  if (params.disposal.taxTreatmentCategory !== 'short_term' && params.disposal.taxTreatmentCategory !== 'long_term') {
    return err(new Error(`Missing canonical US tax treatment for disposal ${params.disposal.id}`));
  }

  return ok({
    acquisitionDate: params.disposal.acquiredAt,
    asset: params.assetLabeler(params.disposal.assetSymbol, params.disposal.assetId),
    disposalAccountLabel: disposalAccountLabelResult.value,
    lotRef,
    taxTreatment: params.disposal.taxTreatmentCategory,
  });
}

function buildDispositionGroupKey(disposal: StandardCostBasisDispositionFilingFact, assetLabel: string): string {
  return `${disposal.disposalTransactionId}|${assetLabel}`;
}

function compareLotsByDateAssetAndId(
  left: StandardCostBasisAcquisitionFilingFact,
  right: StandardCostBasisAcquisitionFilingFact,
  assetLabeler: (symbol: string, assetId: string | undefined) => string
): number {
  const dateDiff = left.acquiredAt.getTime() - right.acquiredAt.getTime();
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
  left: StandardCostBasisDispositionFilingFact,
  right: StandardCostBasisDispositionFilingFact,
  assetLabeler: (symbol: string, assetId: string | undefined) => string
): number {
  const treatmentDiff = taxTreatmentRank(left.taxTreatmentCategory) - taxTreatmentRank(right.taxTreatmentCategory);
  if (treatmentDiff !== 0) {
    return treatmentDiff;
  }

  const dateDisposedDiff = left.disposedAt.getTime() - right.disposedAt.getTime();
  if (dateDisposedDiff !== 0) {
    return dateDisposedDiff;
  }

  const dateAcquiredDiff = left.acquiredAt.getTime() - right.acquiredAt.getTime();
  if (dateAcquiredDiff !== 0) {
    return dateAcquiredDiff;
  }

  const assetDiff = assetLabeler(left.assetSymbol, left.assetId).localeCompare(
    assetLabeler(right.assetSymbol, right.assetId)
  );
  if (assetDiff !== 0) {
    return assetDiff;
  }

  return left.id.localeCompare(right.id);
}

function compareTransferRows(
  left: StandardCostBasisTransferFilingFact,
  right: StandardCostBasisTransferFilingFact,
  assetLabeler: (symbol: string, assetId: string | undefined) => string
): number {
  const dateDiff = left.transferredAt.getTime() - right.transferredAt.getTime();
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

function taxTreatmentRank(value: string | undefined): number {
  if (value === 'short_term') {
    return 0;
  }
  if (value === 'long_term') {
    return 1;
  }
  return 2;
}

function deriveUsTransferBasisSource(_transfer: StandardCostBasisTransferFilingFact): 'fee_basis' | 'lot_carryover' {
  return 'lot_carryover';
}

function deriveUsTransferStatus(transfer: StandardCostBasisTransferFilingFact): 'review_needed_inbound' | 'verified' {
  return transfer.provenanceKind === 'confirmed-link' ? 'verified' : 'review_needed_inbound';
}

function calculateTransferredBasisIncludingFees(transfer: StandardCostBasisTransferFilingFact): Decimal {
  const feeBasis = transfer.sameAssetFeeAmount ?? parseDecimal('0');
  return transfer.totalCostBasis.plus(feeBasis);
}
