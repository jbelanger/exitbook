import type {
  AcquisitionLot,
  CanadaDisplayCostBasisReport,
  CanadaTaxReport,
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
  LotDisposal,
  LotTransfer,
} from '@exitbook/accounting';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import { formatCryptoQuantity } from '../../shared/crypto-format.js';

import type {
  AssetCostBasisItem,
  AcquisitionViewItem,
  DisposalViewItem,
  TransferViewItem,
} from './cost-basis-view-state.js';

const logger = getLogger('cost-basis-view-utils');

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

export function buildAssetCostBasisItems(
  lots: AcquisitionLot[],
  disposals: LotDisposal[],
  lotTransfers: LotTransfer[],
  jurisdiction: string,
  _currency: string,
  report?: {
    disposals: ConvertedLotDisposal[];
    lots: ConvertedAcquisitionLot[];
    lotTransfers: ConvertedLotTransfer[];
  }
): AssetCostBasisItem[] {
  const lotsMap = indexById(lots);
  const convertedDisposalsMap = indexById(report?.disposals);
  const convertedLotsMap = indexById(report?.lots);
  const convertedTransfersMap = indexById(report?.lotTransfers);

  const assetLotsMap = groupItemsByKey(lots, (lot) => lot.assetSymbol);
  const assetDisposalsMap = groupItemsByKey(disposals, (disposal) => {
    const lot = lotsMap.get(disposal.lotId);
    if (!lot) {
      logger.warn({ disposalId: disposal.id, lotId: disposal.lotId }, 'Disposal references missing lot');
      return undefined;
    }

    return lot.assetSymbol;
  });
  const assetTransfersMap = groupItemsByKey(lotTransfers, (transfer) => {
    const sourceLot = lotsMap.get(transfer.sourceLotId);
    if (!sourceLot) {
      logger.warn({ transferId: transfer.id, sourceLotId: transfer.sourceLotId }, 'Transfer references missing lot');
      return undefined;
    }

    return sourceLot.assetSymbol;
  });
  const allAssets = new Set<string>([...assetLotsMap.keys(), ...assetDisposalsMap.keys(), ...assetTransfersMap.keys()]);

  const items: AssetCostBasisItem[] = [];

  for (const asset of allAssets) {
    const assetLots = assetLotsMap.get(asset) ?? [];
    const assetDisposals = assetDisposalsMap.get(asset) ?? [];
    const assetTransfers = assetTransfersMap.get(asset) ?? [];

    let totalProceeds = new Decimal(0);
    let totalCostBasis = new Decimal(0);
    let totalGainLoss = new Decimal(0);
    let shortTermGainLoss = new Decimal(0);
    let longTermGainLoss = new Decimal(0);
    let shortTermCount = 0;
    let longTermCount = 0;
    let totalHoldingDays = 0;
    let shortestHolding = Infinity;
    let longestHolding = 0;

    const acquisitionViewItems: AcquisitionViewItem[] = [];
    for (const lot of assetLots) {
      const converted = convertedLotsMap.get(lot.id);
      const costBasisPerUnit = converted ? converted.displayCostBasisPerUnit : lot.costBasisPerUnit;
      const totalCostBasisLot = converted ? converted.displayTotalCostBasis : lot.totalCostBasis;

      acquisitionViewItems.push({
        type: 'acquisition',
        id: lot.id,
        date: formatDateString(lot.acquisitionDate),
        sortTimestamp: lot.acquisitionDate.toISOString(),
        quantity: formatCryptoQuantity(lot.quantity),
        asset,
        costBasisPerUnit: costBasisPerUnit.toFixed(2),
        totalCostBasis: totalCostBasisLot.toFixed(2),
        transactionId: lot.acquisitionTransactionId,
        lotId: lot.id,
        remainingQuantity: formatCryptoQuantity(lot.remainingQuantity),
        status: lot.status,
        fxConversion: converted
          ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
          : undefined,
        fxUnavailable: converted?.fxUnavailable,
        originalCurrency: converted?.originalCurrency,
      });
    }

    const disposalViewItems: DisposalViewItem[] = [];
    for (const disposal of assetDisposals) {
      const converted = convertedDisposalsMap.get(disposal.id);
      const proceeds = converted ? converted.displayTotalProceeds : disposal.totalProceeds;
      const costBasis = converted ? converted.displayTotalCostBasis : disposal.totalCostBasis;
      const gainLoss = converted ? converted.displayGainLoss : disposal.gainLoss;
      const proceedsPerUnit = converted ? converted.displayProceedsPerUnit : disposal.proceedsPerUnit;
      const costBasisPerUnit = converted ? converted.displayCostBasisPerUnit : disposal.costBasisPerUnit;

      totalProceeds = totalProceeds.plus(proceeds);
      totalCostBasis = totalCostBasis.plus(costBasis);
      totalGainLoss = totalGainLoss.plus(gainLoss);

      const isLongTerm = disposal.holdingPeriodDays > 365;
      if (isLongTerm) {
        longTermGainLoss = longTermGainLoss.plus(gainLoss);
        longTermCount++;
      } else {
        shortTermGainLoss = shortTermGainLoss.plus(gainLoss);
        shortTermCount++;
      }

      totalHoldingDays += disposal.holdingPeriodDays;
      if (disposal.holdingPeriodDays < shortestHolding) shortestHolding = disposal.holdingPeriodDays;
      if (disposal.holdingPeriodDays > longestHolding) longestHolding = disposal.holdingPeriodDays;

      const lot = lotsMap.get(disposal.lotId);
      disposalViewItems.push({
        type: 'disposal',
        id: disposal.id,
        date: formatDateString(disposal.disposalDate),
        sortTimestamp: disposal.disposalDate.toISOString(),
        quantityDisposed: formatCryptoQuantity(disposal.quantityDisposed),
        asset,
        proceedsPerUnit: proceedsPerUnit.toFixed(2),
        totalProceeds: proceeds.toFixed(2),
        costBasisPerUnit: costBasisPerUnit.toFixed(2),
        totalCostBasis: costBasis.toFixed(2),
        gainLoss: gainLoss.toFixed(2),
        taxableGainLoss: computeTaxableAmount(gainLoss, jurisdiction).toFixed(2),
        isGain: gainLoss.gte(0),
        holdingPeriodDays: disposal.holdingPeriodDays,
        taxTreatmentCategory: disposal.taxTreatmentCategory,
        acquisitionDate: lot ? formatDateString(lot.acquisitionDate) : 'unknown',
        acquisitionTransactionId: lot?.acquisitionTransactionId ?? 0,
        disposalTransactionId: disposal.disposalTransactionId,
        fxConversion: converted
          ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
          : undefined,
      });
    }

    const transferViewItems: TransferViewItem[] = [];
    for (const transfer of assetTransfers) {
      const converted = convertedTransfersMap.get(transfer.id);
      const costBasisPerUnit = converted ? converted.displayCostBasisPerUnit : transfer.costBasisPerUnit;
      const totalCostBasisTransfer = converted
        ? converted.displayTotalCostBasis
        : transfer.quantityTransferred.times(transfer.costBasisPerUnit);

      const sourceLot = lotsMap.get(transfer.sourceLotId);

      transferViewItems.push({
        type: 'transfer',
        id: transfer.id,
        date: formatDateString(transfer.transferDate),
        sortTimestamp: transfer.transferDate.toISOString(),
        direction: 'internal',
        quantity: formatCryptoQuantity(transfer.quantityTransferred),
        asset,
        costBasisPerUnit: costBasisPerUnit.toFixed(2),
        totalCostBasis: totalCostBasisTransfer.toFixed(2),
        sourceTransactionId: transfer.sourceTransactionId,
        targetTransactionId: transfer.targetTransactionId,
        sourceLotId: transfer.sourceLotId,
        sourceAcquisitionDate: sourceLot ? formatDateString(sourceLot.acquisitionDate) : 'unknown',
        feeAmount: transfer.metadata?.sameAssetFeeUsdValue?.toFixed(2),
        feeCurrency: transfer.metadata?.sameAssetFeeUsdValue ? 'USD' : undefined,
        fxConversion: converted
          ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
          : undefined,
        fxUnavailable: converted?.fxUnavailable,
        originalCurrency: converted?.originalCurrency,
      });
    }

    const totalTaxableGainLoss = computeTaxableAmount(totalGainLoss, jurisdiction);

    const item: AssetCostBasisItem = {
      asset,
      disposalCount: assetDisposals.length,
      lotCount: assetLots.length,
      transferCount: assetTransfers.length,
      totalProceeds: totalProceeds.toFixed(2),
      totalCostBasis: totalCostBasis.toFixed(2),
      totalGainLoss: totalGainLoss.toFixed(2),
      totalTaxableGainLoss: totalTaxableGainLoss.toFixed(2),
      isGain: totalGainLoss.gte(0),
      ...(assetDisposals.length > 0
        ? {
            avgHoldingDays: Math.round(totalHoldingDays / assetDisposals.length),
            shortestHoldingDays: shortestHolding === Infinity ? 0 : shortestHolding,
            longestHoldingDays: longestHolding,
            hasHoldingPeriodData: true as const,
          }
        : {}),
      disposals: disposalViewItems,
      lots: acquisitionViewItems,
      transfers: transferViewItems,
    };

    if (jurisdiction === 'US') {
      item.shortTermGainLoss = shortTermGainLoss.toFixed(2);
      item.shortTermCount = shortTermCount;
      item.longTermGainLoss = longTermGainLoss.toFixed(2);
      item.longTermCount = longTermCount;
    }

    items.push(item);
  }

  return items;
}

export function buildCanadaAssetCostBasisItems(
  taxReport: CanadaTaxReport,
  displayReport?: CanadaDisplayCostBasisReport
): AssetCostBasisItem[] {
  const assetLabelsByTaxPropertyKey = buildCanadaAssetLabels(taxReport);
  const acquisitionsByTaxProperty = groupItemsByKey(
    taxReport.acquisitions,
    (acquisition) => acquisition.taxPropertyKey
  );
  const dispositionsByTaxProperty = groupItemsByKey(
    taxReport.dispositions,
    (disposition) => disposition.taxPropertyKey
  );
  const displayAcquisitions = indexById(displayReport?.acquisitions);
  const displayDispositions = indexById(displayReport?.dispositions);
  const transfersByTaxProperty = groupItemsByKey(taxReport.transfers, (transfer) => transfer.taxPropertyKey);
  const displayTransfers = indexById(displayReport?.transfers);

  const allTaxProperties = new Set<string>([
    ...acquisitionsByTaxProperty.keys(),
    ...dispositionsByTaxProperty.keys(),
    ...transfersByTaxProperty.keys(),
  ]);

  const items: AssetCostBasisItem[] = [];

  for (const taxPropertyKey of allTaxProperties) {
    const asset = assetLabelsByTaxPropertyKey.get(taxPropertyKey) ?? taxPropertyKey;
    const assetAcquisitions = acquisitionsByTaxProperty.get(taxPropertyKey) ?? [];
    const assetDispositions = dispositionsByTaxProperty.get(taxPropertyKey) ?? [];
    const assetTransfers = transfersByTaxProperty.get(taxPropertyKey) ?? [];
    let totalProceeds = new Decimal(0);
    let totalCostBasis = new Decimal(0);
    let totalGainLoss = new Decimal(0);
    let totalTaxableGainLoss = new Decimal(0);

    const acquisitionViewItems: AcquisitionViewItem[] = assetAcquisitions.map((acquisition) => {
      const converted = displayAcquisitions.get(acquisition.id);
      const totalCost = converted ? converted.displayTotalCost : acquisition.totalCostCad;
      const costBasisPerUnit = converted ? converted.displayCostBasisPerUnit : acquisition.costBasisPerUnitCad;

      return {
        type: 'acquisition',
        id: acquisition.id,
        date: formatDateString(acquisition.acquiredAt),
        sortTimestamp: acquisition.acquiredAt.toISOString(),
        quantity: formatCryptoQuantity(acquisition.quantityAcquired),
        asset,
        costBasisPerUnit: costBasisPerUnit.toFixed(2),
        totalCostBasis: totalCost.toFixed(2),
        transactionId: acquisition.transactionId,
        lotId: acquisition.acquisitionEventId,
        remainingQuantity: formatCryptoQuantity(acquisition.remainingQuantity),
        status: deriveCanadaAcquisitionStatus(acquisition.remainingQuantity, acquisition.quantityAcquired),
        fxConversion: converted
          ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
          : undefined,
      };
    });

    const disposalViewItems: DisposalViewItem[] = assetDispositions.map((disposition) => {
      const converted = displayDispositions.get(disposition.id);
      const proceeds = converted ? converted.displayProceeds : disposition.proceedsCad;
      const costBasis = converted ? converted.displayCostBasis : disposition.costBasisCad;
      const gainLoss = converted ? converted.displayGainLoss : disposition.gainLossCad;
      const taxableGainLoss = converted ? converted.displayTaxableGainLoss : disposition.taxableGainLossCad;

      totalProceeds = totalProceeds.plus(proceeds);
      totalCostBasis = totalCostBasis.plus(costBasis);
      totalGainLoss = totalGainLoss.plus(gainLoss);
      totalTaxableGainLoss = totalTaxableGainLoss.plus(taxableGainLoss);

      return {
        type: 'disposal',
        id: disposition.id,
        date: formatDateString(disposition.disposedAt),
        sortTimestamp: disposition.disposedAt.toISOString(),
        quantityDisposed: formatCryptoQuantity(disposition.quantityDisposed),
        asset,
        proceedsPerUnit: disposition.quantityDisposed.isZero()
          ? '0.00'
          : proceeds.dividedBy(disposition.quantityDisposed).toFixed(2),
        totalProceeds: proceeds.toFixed(2),
        costBasisPerUnit: (converted ? converted.displayAcbPerUnit : disposition.acbPerUnitCad).toFixed(2),
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
      const totalCostBasis = converted ? converted.displayCarriedAcb : transfer.carriedAcbCad;
      const costBasisPerUnit = converted ? converted.displayCarriedAcbPerUnit : transfer.carriedAcbPerUnitCad;
      const marketValue = converted?.displayMarketValue;
      const feeAdjustment = converted ? converted.displayFeeAdjustment : transfer.feeAdjustmentCad;

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
        feeAmount: feeAdjustment.gt(0) ? feeAdjustment.toFixed(2) : undefined,
        feeCurrency: feeAdjustment.gt(0) ? (displayReport?.displayCurrency ?? taxReport.taxCurrency) : undefined,
        fxConversion: converted
          ? { fxRate: converted.fxConversion.fxRate.toFixed(4), fxSource: converted.fxConversion.fxSource }
          : undefined,
      };
    });

    items.push({
      asset,
      disposalCount: assetDispositions.length,
      lotCount: assetAcquisitions.length,
      transferCount: assetTransfers.length,
      totalProceeds: totalProceeds.toFixed(2),
      totalCostBasis: totalCostBasis.toFixed(2),
      totalGainLoss: totalGainLoss.toFixed(2),
      totalTaxableGainLoss: totalTaxableGainLoss.toFixed(2),
      isGain: totalGainLoss.gte(0),
      disposals: disposalViewItems,
      lots: acquisitionViewItems,
      transfers: transferViewItems,
    });
  }

  return items;
}

function buildCanadaAssetLabels(taxReport: CanadaTaxReport): Map<string, string> {
  const assetSymbolsByTaxPropertyKey = new Map<string, string>();
  const taxPropertyCountByAssetSymbol = new Map<string, number>();

  for (const row of [...taxReport.acquisitions, ...taxReport.dispositions, ...taxReport.transfers]) {
    if (assetSymbolsByTaxPropertyKey.has(row.taxPropertyKey)) {
      continue;
    }

    assetSymbolsByTaxPropertyKey.set(row.taxPropertyKey, row.assetSymbol);
    taxPropertyCountByAssetSymbol.set(row.assetSymbol, (taxPropertyCountByAssetSymbol.get(row.assetSymbol) ?? 0) + 1);
  }

  return new Map(
    [...assetSymbolsByTaxPropertyKey.entries()].map(([taxPropertyKey, assetSymbol]) => [
      taxPropertyKey,
      (taxPropertyCountByAssetSymbol.get(assetSymbol) ?? 0) > 1 ? `${assetSymbol} (${taxPropertyKey})` : assetSymbol,
    ])
  );
}

export function sortAssetsByAbsGainLoss(assets: AssetCostBasisItem[]): AssetCostBasisItem[] {
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

/**
 * Compute taxable amount based on jurisdiction rules.
 * Canada: 50% inclusion rate. US: full amount (short/long-term handled at display level).
 */
function computeTaxableAmount(gainLoss: Decimal, jurisdiction: string): Decimal {
  if (jurisdiction === 'CA') {
    return gainLoss.mul(0.5);
  }
  // US, UK, EU: full amount (US short/long-term classification is on the disposal, not the total)
  return gainLoss;
}

/**
 * Compute summary totals from asset items, including US short/long-term split.
 */
export function computeSummaryTotals(
  assets: AssetCostBasisItem[],
  jurisdiction: string
): {
  longTermGainLoss?: string | undefined;
  shortTermGainLoss?: string | undefined;
  totalCostBasis: string;
  totalGainLoss: string;
  totalProceeds: string;
  totalTaxableGainLoss: string;
} {
  let proceeds = new Decimal(0);
  let costBasis = new Decimal(0);
  let gainLoss = new Decimal(0);
  let taxable = new Decimal(0);
  let shortTerm = new Decimal(0);
  let longTerm = new Decimal(0);

  for (const asset of assets) {
    proceeds = proceeds.plus(asset.totalProceeds);
    costBasis = costBasis.plus(asset.totalCostBasis);
    gainLoss = gainLoss.plus(asset.totalGainLoss);
    taxable = taxable.plus(asset.totalTaxableGainLoss);
    if (asset.shortTermGainLoss) shortTerm = shortTerm.plus(asset.shortTermGainLoss);
    if (asset.longTermGainLoss) longTerm = longTerm.plus(asset.longTermGainLoss);
  }

  return {
    totalProceeds: proceeds.toFixed(2),
    totalCostBasis: costBasis.toFixed(2),
    totalGainLoss: gainLoss.toFixed(2),
    totalTaxableGainLoss: taxable.toFixed(2),
    ...(jurisdiction === 'US'
      ? { shortTermGainLoss: shortTerm.toFixed(2), longTermGainLoss: longTerm.toFixed(2) }
      : {}),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format a Date to YYYY-MM-DD string */
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
