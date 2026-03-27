import {
  buildCostBasisFilingFacts,
  type CanadaCostBasisFilingFacts,
  type CanadaDisplayCostBasisReport,
  type ConvertedAcquisitionLot,
  type ConvertedLotDisposal,
  type ConvertedLotTransfer,
  type CostBasisWorkflowResult,
  SUPPORTED_COST_BASIS_FIAT_CURRENCIES,
  type StandardCostBasisDispositionFilingFact,
  type StandardCostBasisFilingFacts,
} from '@exitbook/accounting/cost-basis';
import { Decimal } from 'decimal.js';

import { formatCryptoQuantity } from '../../shared/crypto-format.js';
import { unwrapResult } from '../../shared/result-utils.js';

import type {
  AcquisitionViewItem,
  AssetCostBasisItem,
  CalculationContext,
  DisposalViewItem,
  TransferViewItem,
} from './cost-basis-view-state.js';

interface StandardDisplayCostBasisReportData {
  disposals: ConvertedLotDisposal[];
  lots: ConvertedAcquisitionLot[];
  lotTransfers: ConvertedLotTransfer[];
}

type CanadaDisplayAcquisition = NonNullable<CanadaDisplayCostBasisReport['acquisitions']>[number];
type CanadaDisplayDisposition = NonNullable<CanadaDisplayCostBasisReport['dispositions']>[number];
type CanadaDisplayTransfer = NonNullable<CanadaDisplayCostBasisReport['transfers']>[number];

interface FilingFactAssetIdentity {
  assetSymbol: string;
  assetId?: string | undefined;
  taxPropertyKey?: string | undefined;
}

interface CostBasisPresentationTotals {
  longTermGainLoss?: string | undefined;
  shortTermGainLoss?: string | undefined;
  totalCostBasis: string;
  totalGainLoss: string;
  totalProceeds: string;
  totalTaxableGainLoss: string;
}

interface StandardDisposalMetrics {
  longTermCount: number;
  longTermGainLoss: Decimal;
  longestHoldingDays: number;
  shortTermCount: number;
  shortTermGainLoss: Decimal;
  shortestHoldingDays: number;
  totalCostBasis: Decimal;
  totalGainLoss: Decimal;
  totalHoldingDays: number;
  totalProceeds: Decimal;
  totalTaxableGainLoss: Decimal;
}

interface CanadaDisposalMetrics {
  totalCostBasis: Decimal;
  totalGainLoss: Decimal;
  totalProceeds: Decimal;
  totalTaxableGainLoss: Decimal;
}

interface StandardDisposalBuildResult {
  items: DisposalViewItem[];
  metrics: StandardDisposalMetrics;
}

interface CanadaDisposalBuildResult {
  items: DisposalViewItem[];
  metrics: CanadaDisposalMetrics;
}

function indexById<T extends { id: string }>(items: readonly T[] | undefined): Map<string, T> {
  return new Map(items?.map((item) => [item.id, item]) ?? []);
}

function groupItemsByKey<T>(items: readonly T[], getKey: (item: T) => string | undefined): Map<string, T[]> {
  const groupedItems = new Map<string, T[]>();

  for (const item of items) {
    const key = getKey(item);
    if (key === undefined) {
      continue;
    }

    const existingGroup = groupedItems.get(key);
    if (existingGroup) {
      existingGroup.push(item);
    } else {
      groupedItems.set(key, [item]);
    }
  }

  return groupedItems;
}

export function buildStandardAssetCostBasisItems(
  filingFacts: StandardCostBasisFilingFacts,
  report?: StandardDisplayCostBasisReportData
): AssetCostBasisItem[] {
  const convertedDisposalsMap = indexById(report?.disposals);
  const convertedLotsMap = indexById(report?.lots);
  const convertedTransfersMap = indexById(report?.lotTransfers);
  const assetLabeler = buildStandardAssetLabeler(filingFacts);
  const acquisitionsByAsset = groupItemsByKey(filingFacts.acquisitions, buildFactGroupingKey);
  const dispositionsByAsset = groupItemsByKey(filingFacts.dispositions, buildFactGroupingKey);
  const transfersByAsset = groupItemsByKey(filingFacts.transfers, buildFactGroupingKey);

  return filingFacts.assetSummaries.map((assetSummary) =>
    buildStandardAssetCostBasisItem({
      filingFacts,
      assetSummary,
      acquisitions: acquisitionsByAsset.get(assetSummary.assetGroupingKey) ?? [],
      dispositions: dispositionsByAsset.get(assetSummary.assetGroupingKey) ?? [],
      transfers: transfersByAsset.get(assetSummary.assetGroupingKey) ?? [],
      assetLabeler,
      convertedDisposalsMap,
      convertedLotsMap,
      convertedTransfersMap,
    })
  );
}

export function buildCanadaAssetCostBasisItems(
  filingFacts: CanadaCostBasisFilingFacts,
  displayReport?: CanadaDisplayCostBasisReport
): AssetCostBasisItem[] {
  const assetLabeler = buildCanadaAssetLabeler(filingFacts);
  const displayAcquisitions = indexById(displayReport?.acquisitions);
  const displayDispositions = indexById(displayReport?.dispositions);
  const displayTransfers = indexById(displayReport?.transfers);
  const acquisitionsByAsset = groupItemsByKey(filingFacts.acquisitions, buildFactGroupingKey);
  const dispositionsByAsset = groupItemsByKey(filingFacts.dispositions, buildFactGroupingKey);
  const transfersByAsset = groupItemsByKey(filingFacts.transfers, buildFactGroupingKey);

  return filingFacts.assetSummaries.map((assetSummary) =>
    buildCanadaAssetCostBasisItem({
      filingFacts,
      displayCurrency: displayReport?.displayCurrency,
      assetSummary,
      acquisitions: acquisitionsByAsset.get(assetSummary.assetGroupingKey) ?? [],
      dispositions: dispositionsByAsset.get(assetSummary.assetGroupingKey) ?? [],
      transfers: transfersByAsset.get(assetSummary.assetGroupingKey) ?? [],
      assetLabeler,
      displayAcquisitions,
      displayDispositions,
      displayTransfers,
    })
  );
}

export function buildSummaryTotalsFromAssetItems(
  assets: AssetCostBasisItem[],
  options?: { includeTaxTreatmentSplit?: boolean | undefined }
): CostBasisPresentationTotals {
  let totalProceeds = new Decimal(0);
  let totalCostBasis = new Decimal(0);
  let totalGainLoss = new Decimal(0);
  let totalTaxableGainLoss = new Decimal(0);
  let shortTermGainLoss = new Decimal(0);
  let longTermGainLoss = new Decimal(0);

  for (const asset of assets) {
    totalProceeds = totalProceeds.plus(asset.totalProceeds);
    totalCostBasis = totalCostBasis.plus(asset.totalCostBasis);
    totalGainLoss = totalGainLoss.plus(asset.totalGainLoss);
    totalTaxableGainLoss = totalTaxableGainLoss.plus(asset.totalTaxableGainLoss);

    if (asset.shortTermGainLoss !== undefined) {
      shortTermGainLoss = shortTermGainLoss.plus(asset.shortTermGainLoss);
    }
    if (asset.longTermGainLoss !== undefined) {
      longTermGainLoss = longTermGainLoss.plus(asset.longTermGainLoss);
    }
  }

  return {
    totalProceeds: totalProceeds.toFixed(2),
    totalCostBasis: totalCostBasis.toFixed(2),
    totalGainLoss: totalGainLoss.toFixed(2),
    totalTaxableGainLoss: totalTaxableGainLoss.toFixed(2),
    ...(options?.includeTaxTreatmentSplit
      ? {
          shortTermGainLoss: shortTermGainLoss.toFixed(2),
          longTermGainLoss: longTermGainLoss.toFixed(2),
        }
      : {}),
  };
}

function sortAssetsByAbsGainLoss(assets: AssetCostBasisItem[]): AssetCostBasisItem[] {
  return [...assets].sort((a, b) => {
    const absA = Math.abs(parseFloat(a.totalGainLoss));
    const absB = Math.abs(parseFloat(b.totalGainLoss));
    if (absB !== absA) return absB - absA;
    return a.asset.localeCompare(b.asset);
  });
}

export function formatSignedCurrency(amount: string, currency: string): string {
  const decimal = new Decimal(amount);
  const isNegative = decimal.isNegative();
  const absFormatted = decimal.abs().toFixed(2);

  const parts = absFormatted.split('.');
  if (parts[0]) {
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const withSeparators = parts.join('.');

  const sign = isNegative ? '-' : '+';
  return `${sign}${currency} ${withSeparators}`;
}

export function formatUnsignedCurrency(amount: string, currency: string): string {
  const decimal = new Decimal(amount);
  const formatted = decimal.abs().toFixed(2);

  const parts = formatted.split('.');
  if (parts[0]) {
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  return `${currency} ${parts.join('.')}`;
}

function buildFactGroupingKey(fact: FilingFactAssetIdentity): string {
  return fact.taxPropertyKey ?? fact.assetId ?? fact.assetSymbol;
}

function buildStandardAssetLabeler(
  filingFacts: StandardCostBasisFilingFacts
): (symbol: string, assetId: string | undefined) => string {
  const assetIdsBySymbol = new Map<string, Set<string>>();

  for (const assetSummary of filingFacts.assetSummaries) {
    if (!assetSummary.assetId) {
      continue;
    }

    const assetIds = assetIdsBySymbol.get(assetSummary.assetSymbol) ?? new Set<string>();
    assetIds.add(assetSummary.assetId);
    assetIdsBySymbol.set(assetSummary.assetSymbol, assetIds);
  }

  return (symbol: string, assetId: string | undefined) => {
    const assetIds = assetIdsBySymbol.get(symbol);
    if (!assetId || !assetIds || assetIds.size <= 1) {
      return symbol;
    }

    return `${symbol} (${assetId})`;
  };
}

function buildCanadaAssetLabeler(
  filingFacts: CanadaCostBasisFilingFacts
): (symbol: string, taxPropertyKey: string | undefined) => string {
  const taxPropertyCountByAssetSymbol = new Map<string, number>();

  for (const assetSummary of filingFacts.assetSummaries) {
    taxPropertyCountByAssetSymbol.set(
      assetSummary.assetSymbol,
      (taxPropertyCountByAssetSymbol.get(assetSummary.assetSymbol) ?? 0) + 1
    );
  }

  return (symbol: string, taxPropertyKey: string | undefined) => {
    if (!taxPropertyKey || (taxPropertyCountByAssetSymbol.get(symbol) ?? 0) <= 1) {
      return symbol;
    }

    return `${symbol} (${taxPropertyKey})`;
  };
}

function resolveStandardDisplayTaxableGainLoss(
  disposal: StandardCostBasisDispositionFilingFact,
  converted: ConvertedLotDisposal | undefined
): Decimal {
  if (!converted) {
    return disposal.taxableGainLoss;
  }

  return disposal.taxableGainLoss.times(converted.fxConversion.fxRate);
}

function formatDateString(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}

function toPresentationFiatCurrency(currency: string): CalculationContext['currency'] {
  if (SUPPORTED_COST_BASIS_FIAT_CURRENCIES.includes(currency as CalculationContext['currency'])) {
    return currency as CalculationContext['currency'];
  }

  throw new Error(`Unsupported cost-basis presentation currency '${currency}'`);
}

function createStandardDisposalMetrics(): StandardDisposalMetrics {
  return {
    totalProceeds: new Decimal(0),
    totalCostBasis: new Decimal(0),
    totalGainLoss: new Decimal(0),
    totalTaxableGainLoss: new Decimal(0),
    shortTermGainLoss: new Decimal(0),
    longTermGainLoss: new Decimal(0),
    shortTermCount: 0,
    longTermCount: 0,
    totalHoldingDays: 0,
    shortestHoldingDays: Infinity,
    longestHoldingDays: 0,
  };
}

function createCanadaDisposalMetrics(): CanadaDisposalMetrics {
  return {
    totalProceeds: new Decimal(0),
    totalCostBasis: new Decimal(0),
    totalGainLoss: new Decimal(0),
    totalTaxableGainLoss: new Decimal(0),
  };
}

function buildStandardAcquisitionViewItems(
  acquisitions: StandardCostBasisFilingFacts['acquisitions'],
  asset: string,
  convertedLotsMap: Map<string, ConvertedAcquisitionLot>
): AcquisitionViewItem[] {
  return acquisitions.map((acquisition) => {
    const converted = convertedLotsMap.get(acquisition.id);
    const costBasisPerUnit = converted ? converted.displayCostBasisPerUnit : acquisition.costBasisPerUnit;
    const acquisitionTotalCostBasis = converted ? converted.displayTotalCostBasis : acquisition.totalCostBasis;

    return {
      type: 'acquisition',
      id: acquisition.id,
      date: formatDateString(acquisition.acquiredAt),
      sortTimestamp: acquisition.acquiredAt.toISOString(),
      quantity: formatCryptoQuantity(acquisition.quantity),
      asset,
      costBasisPerUnit: costBasisPerUnit.toFixed(2),
      totalCostBasis: acquisitionTotalCostBasis.toFixed(2),
      transactionId: acquisition.transactionId,
      lotId: acquisition.id,
      remainingQuantity: formatCryptoQuantity(acquisition.remainingQuantity),
      status: acquisition.status,
      fxConversion: converted
        ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
        : undefined,
      fxUnavailable: converted?.fxUnavailable,
      originalCurrency: converted?.originalCurrency,
    };
  });
}

function buildStandardDisposalViewItems(
  disposals: StandardCostBasisDispositionFilingFact[],
  asset: string,
  convertedDisposalsMap: Map<string, ConvertedLotDisposal>
): StandardDisposalBuildResult {
  const metrics = createStandardDisposalMetrics();
  const items = disposals.map((disposal) => {
    const converted = convertedDisposalsMap.get(disposal.id);
    const proceedsPerUnit = converted ? converted.displayProceedsPerUnit : disposal.proceedsPerUnit;
    const proceeds = converted ? converted.displayTotalProceeds : disposal.totalProceeds;
    const costBasisPerUnit = converted ? converted.displayCostBasisPerUnit : disposal.costBasisPerUnit;
    const costBasis = converted ? converted.displayTotalCostBasis : disposal.totalCostBasis;
    const gainLoss = converted ? converted.displayGainLoss : disposal.gainLoss;
    const taxableGainLoss = resolveStandardDisplayTaxableGainLoss(disposal, converted);

    metrics.totalProceeds = metrics.totalProceeds.plus(proceeds);
    metrics.totalCostBasis = metrics.totalCostBasis.plus(costBasis);
    metrics.totalGainLoss = metrics.totalGainLoss.plus(gainLoss);
    metrics.totalTaxableGainLoss = metrics.totalTaxableGainLoss.plus(taxableGainLoss);
    metrics.totalHoldingDays += disposal.holdingPeriodDays;
    metrics.shortestHoldingDays = Math.min(metrics.shortestHoldingDays, disposal.holdingPeriodDays);
    metrics.longestHoldingDays = Math.max(metrics.longestHoldingDays, disposal.holdingPeriodDays);

    if (disposal.taxTreatmentCategory === 'long_term') {
      metrics.longTermGainLoss = metrics.longTermGainLoss.plus(gainLoss);
      metrics.longTermCount += 1;
    } else if (disposal.taxTreatmentCategory === 'short_term') {
      metrics.shortTermGainLoss = metrics.shortTermGainLoss.plus(gainLoss);
      metrics.shortTermCount += 1;
    }

    return {
      type: 'disposal',
      id: disposal.id,
      date: formatDateString(disposal.disposedAt),
      sortTimestamp: disposal.disposedAt.toISOString(),
      quantityDisposed: formatCryptoQuantity(disposal.quantity),
      asset,
      proceedsPerUnit: proceedsPerUnit.toFixed(2),
      totalProceeds: proceeds.toFixed(2),
      costBasisPerUnit: costBasisPerUnit.toFixed(2),
      totalCostBasis: costBasis.toFixed(2),
      gainLoss: gainLoss.toFixed(2),
      taxableGainLoss: taxableGainLoss.toFixed(2),
      isGain: gainLoss.gte(0),
      holdingPeriodDays: disposal.holdingPeriodDays,
      taxTreatmentCategory: disposal.taxTreatmentCategory,
      acquisitionDate: formatDateString(disposal.acquiredAt),
      acquisitionTransactionId: disposal.acquisitionTransactionId,
      disposalTransactionId: disposal.disposalTransactionId,
      fxConversion: converted
        ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
        : undefined,
    } satisfies DisposalViewItem;
  });

  return { items, metrics };
}

function buildStandardTransferViewItems(
  transfers: StandardCostBasisFilingFacts['transfers'],
  asset: string,
  filingFacts: StandardCostBasisFilingFacts,
  convertedTransfersMap: Map<string, ConvertedLotTransfer>
): TransferViewItem[] {
  return transfers.map((transfer) => {
    const converted = convertedTransfersMap.get(transfer.id);
    const costBasisPerUnit = converted ? converted.displayCostBasisPerUnit : transfer.costBasisPerUnit;
    const transferTotalCostBasis = converted ? converted.displayTotalCostBasis : transfer.totalCostBasis;
    const feeAmount =
      transfer.sameAssetFeeAmount && transfer.sameAssetFeeAmount.gt(0)
        ? transfer.sameAssetFeeAmount.toFixed(2)
        : undefined;

    return {
      type: 'transfer',
      id: transfer.id,
      date: formatDateString(transfer.transferredAt),
      sortTimestamp: transfer.transferredAt.toISOString(),
      direction: 'internal',
      quantity: formatCryptoQuantity(transfer.quantity),
      asset,
      costBasisPerUnit: costBasisPerUnit.toFixed(2),
      totalCostBasis: transferTotalCostBasis.toFixed(2),
      sourceTransactionId: transfer.sourceTransactionId,
      targetTransactionId: transfer.targetTransactionId,
      sourceLotId: transfer.sourceLotId,
      sourceAcquisitionDate: transfer.sourceAcquiredAt ? formatDateString(transfer.sourceAcquiredAt) : undefined,
      feeAmount,
      feeCurrency: feeAmount ? filingFacts.taxCurrency : undefined,
      fxConversion: converted
        ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
        : undefined,
      fxUnavailable: converted?.fxUnavailable,
      originalCurrency: converted?.originalCurrency,
    };
  });
}

function buildStandardAssetCostBasisItem(params: {
  acquisitions: StandardCostBasisFilingFacts['acquisitions'];
  assetLabeler: (symbol: string, assetId: string | undefined) => string;
  assetSummary: StandardCostBasisFilingFacts['assetSummaries'][number];
  convertedDisposalsMap: Map<string, ConvertedLotDisposal>;
  convertedLotsMap: Map<string, ConvertedAcquisitionLot>;
  convertedTransfersMap: Map<string, ConvertedLotTransfer>;
  dispositions: StandardCostBasisDispositionFilingFact[];
  filingFacts: StandardCostBasisFilingFacts;
  transfers: StandardCostBasisFilingFacts['transfers'];
}): AssetCostBasisItem {
  const asset = params.assetLabeler(params.assetSummary.assetSymbol, params.assetSummary.assetId);
  const lots = buildStandardAcquisitionViewItems(params.acquisitions, asset, params.convertedLotsMap);
  const { items: disposals, metrics } = buildStandardDisposalViewItems(
    params.dispositions,
    asset,
    params.convertedDisposalsMap
  );
  const transfers = buildStandardTransferViewItems(
    params.transfers,
    asset,
    params.filingFacts,
    params.convertedTransfersMap
  );

  const item: AssetCostBasisItem = {
    asset,
    disposalCount: params.assetSummary.dispositionCount,
    lotCount: params.assetSummary.acquisitionCount,
    transferCount: params.assetSummary.transferCount,
    totalProceeds: metrics.totalProceeds.toFixed(2),
    totalCostBasis: metrics.totalCostBasis.toFixed(2),
    totalGainLoss: metrics.totalGainLoss.toFixed(2),
    totalTaxableGainLoss: metrics.totalTaxableGainLoss.toFixed(2),
    isGain: metrics.totalGainLoss.gte(0),
    ...(params.dispositions.length > 0
      ? {
          avgHoldingDays: Math.round(metrics.totalHoldingDays / params.dispositions.length),
          shortestHoldingDays: metrics.shortestHoldingDays === Infinity ? 0 : metrics.shortestHoldingDays,
          longestHoldingDays: metrics.longestHoldingDays,
          hasHoldingPeriodData: true as const,
        }
      : {}),
    disposals,
    lots,
    transfers,
  };

  if (params.filingFacts.jurisdiction === 'US') {
    item.shortTermGainLoss = metrics.shortTermGainLoss.toFixed(2);
    item.shortTermCount = metrics.shortTermCount;
    item.longTermGainLoss = metrics.longTermGainLoss.toFixed(2);
    item.longTermCount = metrics.longTermCount;
  }

  return item;
}

function buildCanadaAcquisitionViewItems(
  acquisitions: CanadaCostBasisFilingFacts['acquisitions'],
  asset: string,
  displayAcquisitions: Map<string, CanadaDisplayAcquisition>
): AcquisitionViewItem[] {
  return acquisitions.map((acquisition) => {
    const converted = displayAcquisitions.get(acquisition.id);
    const totalCostBasis = converted ? converted.displayTotalCost : acquisition.totalCostBasis;
    const costBasisPerUnit = converted ? converted.displayCostBasisPerUnit : acquisition.costBasisPerUnit;

    return {
      type: 'acquisition',
      id: acquisition.id,
      date: formatDateString(acquisition.acquiredAt),
      sortTimestamp: acquisition.acquiredAt.toISOString(),
      quantity: formatCryptoQuantity(acquisition.quantity),
      asset,
      costBasisPerUnit: costBasisPerUnit.toFixed(2),
      totalCostBasis: totalCostBasis.toFixed(2),
      transactionId: acquisition.transactionId,
      lotId: acquisition.acquisitionEventId,
      remainingQuantity: formatCryptoQuantity(acquisition.remainingQuantity),
      status: deriveCanadaAcquisitionStatus(acquisition.remainingQuantity, acquisition.quantity),
      fxConversion: converted
        ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
        : undefined,
    };
  });
}

function buildCanadaDisposalViewItems(
  dispositions: CanadaCostBasisFilingFacts['dispositions'],
  asset: string,
  displayDispositions: Map<string, CanadaDisplayDisposition>
): CanadaDisposalBuildResult {
  const metrics = createCanadaDisposalMetrics();
  const items = dispositions.map((disposition) => {
    const converted = displayDispositions.get(disposition.id);
    const proceeds = converted ? converted.displayProceeds : disposition.totalProceeds;
    const costBasis = converted ? converted.displayCostBasis : disposition.totalCostBasis;
    const gainLoss = converted ? converted.displayGainLoss : disposition.gainLoss;
    const taxableGainLoss = converted ? converted.displayTaxableGainLoss : disposition.taxableGainLoss;
    const costBasisPerUnit = converted ? converted.displayAcbPerUnit : disposition.costBasisPerUnit;

    metrics.totalProceeds = metrics.totalProceeds.plus(proceeds);
    metrics.totalCostBasis = metrics.totalCostBasis.plus(costBasis);
    metrics.totalGainLoss = metrics.totalGainLoss.plus(gainLoss);
    metrics.totalTaxableGainLoss = metrics.totalTaxableGainLoss.plus(taxableGainLoss);

    return {
      type: 'disposal',
      id: disposition.id,
      date: formatDateString(disposition.disposedAt),
      sortTimestamp: disposition.disposedAt.toISOString(),
      quantityDisposed: formatCryptoQuantity(disposition.quantity),
      asset,
      proceedsPerUnit: disposition.quantity.isZero() ? '0.00' : proceeds.dividedBy(disposition.quantity).toFixed(2),
      totalProceeds: proceeds.toFixed(2),
      costBasisPerUnit: costBasisPerUnit.toFixed(2),
      totalCostBasis: costBasis.toFixed(2),
      gainLoss: gainLoss.toFixed(2),
      taxableGainLoss: taxableGainLoss.toFixed(2),
      isGain: gainLoss.gte(0),
      disposalTransactionId: disposition.transactionId,
      fxConversion: converted
        ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
        : undefined,
    } satisfies DisposalViewItem;
  });

  return { items, metrics };
}

function buildCanadaTransferViewItems(params: {
  asset: string;
  displayCurrency?: string | undefined;
  displayTransfers: Map<string, CanadaDisplayTransfer>;
  filingFacts: CanadaCostBasisFilingFacts;
  transfers: CanadaCostBasisFilingFacts['transfers'];
}): TransferViewItem[] {
  return params.transfers.map((transfer) => {
    const converted = params.displayTransfers.get(transfer.id);
    const totalCostBasis = converted ? converted.displayCarriedAcb : transfer.totalCostBasis;
    const costBasisPerUnit = converted ? converted.displayCarriedAcbPerUnit : transfer.costBasisPerUnit;
    const marketValue = converted?.displayMarketValue;
    const feeAdjustment = converted ? converted.displayFeeAdjustment : transfer.feeAdjustment;
    const feeAmount = feeAdjustment.gt(0) ? feeAdjustment.toFixed(2) : undefined;

    return {
      type: 'transfer',
      id: transfer.id,
      date: formatDateString(transfer.transferredAt),
      sortTimestamp: transfer.transferredAt.toISOString(),
      direction: transfer.direction,
      quantity: formatCryptoQuantity(transfer.quantity),
      asset: params.asset,
      costBasisPerUnit: costBasisPerUnit.toFixed(2),
      totalCostBasis: totalCostBasis.toFixed(2),
      marketValue: marketValue?.toFixed(2),
      sourceTransactionId: transfer.sourceTransactionId,
      targetTransactionId: transfer.targetTransactionId,
      feeAmount,
      feeCurrency: feeAmount ? (params.displayCurrency ?? params.filingFacts.taxCurrency) : undefined,
      fxConversion: converted
        ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
        : undefined,
    };
  });
}

function buildCanadaAssetCostBasisItem(params: {
  acquisitions: CanadaCostBasisFilingFacts['acquisitions'];
  assetLabeler: (symbol: string, taxPropertyKey: string | undefined) => string;
  assetSummary: CanadaCostBasisFilingFacts['assetSummaries'][number];
  displayAcquisitions: Map<string, CanadaDisplayAcquisition>;
  displayCurrency?: string | undefined;
  displayDispositions: Map<string, CanadaDisplayDisposition>;
  displayTransfers: Map<string, CanadaDisplayTransfer>;
  dispositions: CanadaCostBasisFilingFacts['dispositions'];
  filingFacts: CanadaCostBasisFilingFacts;
  transfers: CanadaCostBasisFilingFacts['transfers'];
}): AssetCostBasisItem {
  const asset = params.assetLabeler(params.assetSummary.assetSymbol, params.assetSummary.taxPropertyKey);
  const lots = buildCanadaAcquisitionViewItems(params.acquisitions, asset, params.displayAcquisitions);
  const { items: disposals, metrics } = buildCanadaDisposalViewItems(
    params.dispositions,
    asset,
    params.displayDispositions
  );
  const transfers = buildCanadaTransferViewItems({
    asset,
    displayCurrency: params.displayCurrency,
    displayTransfers: params.displayTransfers,
    filingFacts: params.filingFacts,
    transfers: params.transfers,
  });

  return {
    asset,
    disposalCount: params.assetSummary.dispositionCount,
    lotCount: params.assetSummary.acquisitionCount,
    transferCount: params.assetSummary.transferCount,
    totalProceeds: metrics.totalProceeds.toFixed(2),
    totalCostBasis: metrics.totalCostBasis.toFixed(2),
    totalGainLoss: metrics.totalGainLoss.toFixed(2),
    totalTaxableGainLoss: metrics.totalTaxableGainLoss.toFixed(2),
    isGain: metrics.totalGainLoss.gte(0),
    disposals,
    lots,
    transfers,
  };
}

function deriveCanadaAcquisitionStatus(
  remainingQuantity: Decimal,
  quantityAcquired: Decimal
): AcquisitionViewItem['status'] {
  if (remainingQuantity.lte(0)) {
    return 'fully_disposed';
  }

  if (remainingQuantity.gte(quantityAcquired)) {
    return 'open';
  }

  return 'partially_disposed';
}

// ─── Presentation Model ──────────────────────────────────────────────────────

export interface CostBasisPresentationModel {
  assetItems: AssetCostBasisItem[];
  context: CalculationContext;
  summary: {
    assetsProcessed: string[];
    disposalsProcessed: number;
    longTermGainLoss?: string | undefined;
    lotsCreated: number;
    shortTermGainLoss?: string | undefined;
    totalCostBasis: string;
    totalGainLoss: string;
    totalProceeds: string;
    totalTaxableGainLoss: string;
    transactionsProcessed: number;
  };
}

export function buildPresentationModel(costBasisResult: CostBasisWorkflowResult): CostBasisPresentationModel {
  const filingFacts = unwrapResult(buildCostBasisFilingFacts({ artifact: costBasisResult }));

  if (costBasisResult.kind === 'standard-workflow') {
    if (filingFacts.kind !== 'standard') {
      throw new Error('Expected standard filing facts for standard-workflow artifact');
    }

    const { summary, report } = costBasisResult;
    const { config } = summary.calculation;
    const jurisdiction = config.jurisdiction;
    const currency = toPresentationFiatCurrency(report?.displayCurrency ?? config.currency);
    const assetItems = sortAssetsByAbsGainLoss(buildStandardAssetCostBasisItems(filingFacts, report));
    const summaryTotals = buildSummaryTotalsFromAssetItems(assetItems, {
      includeTaxTreatmentSplit: jurisdiction === 'US',
    });

    return {
      assetItems,
      context: {
        calculationId: filingFacts.calculationId,
        method: config.method,
        jurisdiction,
        taxYear: config.taxYear,
        currency,
        dateRange: {
          startDate: summary.calculation.startDate?.toISOString().split('T')[0] ?? '',
          endDate: summary.calculation.endDate?.toISOString().split('T')[0] ?? '',
        },
      },
      summary: {
        lotsCreated: filingFacts.summary.acquisitionCount,
        disposalsProcessed: filingFacts.summary.dispositionCount,
        assetsProcessed: summary.assetsProcessed,
        transactionsProcessed: summary.calculation.transactionsProcessed,
        totalProceeds: summaryTotals.totalProceeds,
        totalCostBasis: summaryTotals.totalCostBasis,
        totalGainLoss: summaryTotals.totalGainLoss,
        totalTaxableGainLoss: summaryTotals.totalTaxableGainLoss,
        ...(summaryTotals.shortTermGainLoss ? { shortTermGainLoss: summaryTotals.shortTermGainLoss } : {}),
        ...(summaryTotals.longTermGainLoss ? { longTermGainLoss: summaryTotals.longTermGainLoss } : {}),
      },
    };
  }

  if (filingFacts.kind !== 'canada') {
    throw new Error('Expected Canada filing facts for canada-workflow artifact');
  }

  const currency = toPresentationFiatCurrency(
    costBasisResult.displayReport?.displayCurrency ?? costBasisResult.calculation.displayCurrency
  );
  const assetItems = sortAssetsByAbsGainLoss(
    buildCanadaAssetCostBasisItems(filingFacts, costBasisResult.displayReport)
  );
  const summaryTotals = buildSummaryTotalsFromAssetItems(assetItems);

  return {
    assetItems,
    context: {
      calculationId: filingFacts.calculationId,
      method: costBasisResult.calculation.method,
      jurisdiction: costBasisResult.calculation.jurisdiction,
      taxYear: costBasisResult.calculation.taxYear,
      currency,
      dateRange: {
        startDate: costBasisResult.calculation.startDate.toISOString().split('T')[0] ?? '',
        endDate: costBasisResult.calculation.endDate.toISOString().split('T')[0] ?? '',
      },
    },
    summary: {
      lotsCreated: filingFacts.summary.acquisitionCount,
      disposalsProcessed: filingFacts.summary.dispositionCount,
      assetsProcessed: costBasisResult.calculation.assetsProcessed,
      transactionsProcessed: costBasisResult.calculation.transactionsProcessed,
      totalProceeds: summaryTotals.totalProceeds,
      totalCostBasis: summaryTotals.totalCostBasis,
      totalGainLoss: summaryTotals.totalGainLoss,
      totalTaxableGainLoss: summaryTotals.totalTaxableGainLoss,
    },
  };
}
