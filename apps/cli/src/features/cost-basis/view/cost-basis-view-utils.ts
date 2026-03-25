import {
  buildCostBasisFilingFacts,
  type CanadaCostBasisFilingFacts,
  type CanadaDisplayCostBasisReport,
  type ConvertedAcquisitionLot,
  type ConvertedLotDisposal,
  type ConvertedLotTransfer,
  type CostBasisWorkflowResult,
  type StandardCostBasisDispositionFilingFact,
  type StandardCostBasisFilingFacts,
} from '@exitbook/accounting';
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

  return filingFacts.assetSummaries.map((assetSummary) => {
    const assetKey = assetSummary.assetGroupingKey;
    const asset = assetLabeler(assetSummary.assetSymbol, assetSummary.assetId);
    const assetAcquisitions = acquisitionsByAsset.get(assetKey) ?? [];
    const assetDispositions = dispositionsByAsset.get(assetKey) ?? [];
    const assetTransfers = transfersByAsset.get(assetKey) ?? [];

    let totalProceeds = new Decimal(0);
    let totalCostBasis = new Decimal(0);
    let totalGainLoss = new Decimal(0);
    let totalTaxableGainLoss = new Decimal(0);
    let shortTermGainLoss = new Decimal(0);
    let longTermGainLoss = new Decimal(0);
    let shortTermCount = 0;
    let longTermCount = 0;
    let totalHoldingDays = 0;
    let shortestHolding = Infinity;
    let longestHolding = 0;

    const acquisitionViewItems: AcquisitionViewItem[] = assetAcquisitions.map((acquisition) => {
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

    const disposalViewItems: DisposalViewItem[] = assetDispositions.map((disposal) => {
      const converted = convertedDisposalsMap.get(disposal.id);
      const proceedsPerUnit = converted ? converted.displayProceedsPerUnit : disposal.proceedsPerUnit;
      const proceeds = converted ? converted.displayTotalProceeds : disposal.totalProceeds;
      const costBasisPerUnit = converted ? converted.displayCostBasisPerUnit : disposal.costBasisPerUnit;
      const costBasis = converted ? converted.displayTotalCostBasis : disposal.totalCostBasis;
      const gainLoss = converted ? converted.displayGainLoss : disposal.gainLoss;
      const taxableGainLoss = resolveStandardDisplayTaxableGainLoss(disposal, converted);

      totalProceeds = totalProceeds.plus(proceeds);
      totalCostBasis = totalCostBasis.plus(costBasis);
      totalGainLoss = totalGainLoss.plus(gainLoss);
      totalTaxableGainLoss = totalTaxableGainLoss.plus(taxableGainLoss);

      if (disposal.taxTreatmentCategory === 'long_term') {
        longTermGainLoss = longTermGainLoss.plus(gainLoss);
        longTermCount += 1;
      } else if (disposal.taxTreatmentCategory === 'short_term') {
        shortTermGainLoss = shortTermGainLoss.plus(gainLoss);
        shortTermCount += 1;
      }

      totalHoldingDays += disposal.holdingPeriodDays;
      if (disposal.holdingPeriodDays < shortestHolding) {
        shortestHolding = disposal.holdingPeriodDays;
      }
      if (disposal.holdingPeriodDays > longestHolding) {
        longestHolding = disposal.holdingPeriodDays;
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
      };
    });

    const transferViewItems: TransferViewItem[] = assetTransfers.map((transfer) => {
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

    const item: AssetCostBasisItem = {
      asset,
      disposalCount: assetSummary.dispositionCount,
      lotCount: assetSummary.acquisitionCount,
      transferCount: assetSummary.transferCount,
      totalProceeds: totalProceeds.toFixed(2),
      totalCostBasis: totalCostBasis.toFixed(2),
      totalGainLoss: totalGainLoss.toFixed(2),
      totalTaxableGainLoss: totalTaxableGainLoss.toFixed(2),
      isGain: totalGainLoss.gte(0),
      ...(assetDispositions.length > 0
        ? {
            avgHoldingDays: Math.round(totalHoldingDays / assetDispositions.length),
            shortestHoldingDays: shortestHolding === Infinity ? 0 : shortestHolding,
            longestHoldingDays: longestHolding,
            hasHoldingPeriodData: true as const,
          }
        : {}),
      disposals: disposalViewItems,
      lots: acquisitionViewItems,
      transfers: transferViewItems,
    };

    if (filingFacts.jurisdiction === 'US') {
      item.shortTermGainLoss = shortTermGainLoss.toFixed(2);
      item.shortTermCount = shortTermCount;
      item.longTermGainLoss = longTermGainLoss.toFixed(2);
      item.longTermCount = longTermCount;
    }

    return item;
  });
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

  return filingFacts.assetSummaries.map((assetSummary) => {
    const assetKey = assetSummary.assetGroupingKey;
    const asset = assetLabeler(assetSummary.assetSymbol, assetSummary.taxPropertyKey);
    const assetAcquisitions = acquisitionsByAsset.get(assetKey) ?? [];
    const assetDispositions = dispositionsByAsset.get(assetKey) ?? [];
    const assetTransfers = transfersByAsset.get(assetKey) ?? [];

    let totalProceeds = new Decimal(0);
    let totalCostBasis = new Decimal(0);
    let totalGainLoss = new Decimal(0);
    let totalTaxableGainLoss = new Decimal(0);

    const acquisitionViewItems: AcquisitionViewItem[] = assetAcquisitions.map((acquisition) => {
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

    const disposalViewItems: DisposalViewItem[] = assetDispositions.map((disposition) => {
      const converted = displayDispositions.get(disposition.id);
      const proceeds = converted ? converted.displayProceeds : disposition.totalProceeds;
      const costBasis = converted ? converted.displayCostBasis : disposition.totalCostBasis;
      const gainLoss = converted ? converted.displayGainLoss : disposition.gainLoss;
      const taxableGainLoss = converted ? converted.displayTaxableGainLoss : disposition.taxableGainLoss;
      const costBasisPerUnit = converted ? converted.displayAcbPerUnit : disposition.costBasisPerUnit;

      totalProceeds = totalProceeds.plus(proceeds);
      totalCostBasis = totalCostBasis.plus(costBasis);
      totalGainLoss = totalGainLoss.plus(gainLoss);
      totalTaxableGainLoss = totalTaxableGainLoss.plus(taxableGainLoss);

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
      };
    });

    const transferViewItems: TransferViewItem[] = assetTransfers.map((transfer) => {
      const converted = displayTransfers.get(transfer.id);
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
        asset,
        costBasisPerUnit: costBasisPerUnit.toFixed(2),
        totalCostBasis: totalCostBasis.toFixed(2),
        marketValue: marketValue?.toFixed(2),
        sourceTransactionId: transfer.sourceTransactionId,
        targetTransactionId: transfer.targetTransactionId,
        feeAmount,
        feeCurrency: feeAmount ? (displayReport?.displayCurrency ?? filingFacts.taxCurrency) : undefined,
        fxConversion: converted
          ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
          : undefined,
      };
    });

    return {
      asset,
      disposalCount: assetSummary.dispositionCount,
      lotCount: assetSummary.acquisitionCount,
      transferCount: assetSummary.transferCount,
      totalProceeds: totalProceeds.toFixed(2),
      totalCostBasis: totalCostBasis.toFixed(2),
      totalGainLoss: totalGainLoss.toFixed(2),
      totalTaxableGainLoss: totalTaxableGainLoss.toFixed(2),
      isGain: totalGainLoss.gte(0),
      disposals: disposalViewItems,
      lots: acquisitionViewItems,
      transfers: transferViewItems,
    };
  });
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

function deriveCanadaAcquisitionStatus(remainingQuantity: Decimal, quantityAcquired: Decimal): string {
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
    const jurisdiction = filingFacts.jurisdiction;
    const currency = report?.displayCurrency ?? filingFacts.taxCurrency;
    const assetItems = sortAssetsByAbsGainLoss(buildStandardAssetCostBasisItems(filingFacts, report));
    const summaryTotals = buildSummaryTotalsFromAssetItems(assetItems, {
      includeTaxTreatmentSplit: jurisdiction === 'US',
    });

    return {
      assetItems,
      context: {
        calculationId: filingFacts.calculationId,
        method: filingFacts.method,
        jurisdiction,
        taxYear: filingFacts.taxYear,
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

  const currency = costBasisResult.displayReport?.displayCurrency ?? filingFacts.taxCurrency;
  const assetItems = sortAssetsByAbsGainLoss(
    buildCanadaAssetCostBasisItems(filingFacts, costBasisResult.displayReport)
  );
  const summaryTotals = buildSummaryTotalsFromAssetItems(assetItems);

  return {
    assetItems,
    context: {
      calculationId: filingFacts.calculationId,
      method: filingFacts.method,
      jurisdiction: filingFacts.jurisdiction,
      taxYear: filingFacts.taxYear,
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
