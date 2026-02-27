/**
 * Cost basis view pure utility functions.
 */

import type {
  AcquisitionLot,
  ConvertedAcquisitionLot,
  ConvertedLotDisposal,
  ConvertedLotTransfer,
  LotDisposal,
  LotTransfer,
} from '@exitbook/accounting';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import type {
  AssetCostBasisItem,
  AcquisitionViewItem,
  DisposalViewItem,
  TransferViewItem,
} from './components/cost-basis-view-state.js';

const logger = getLogger('cost-basis-view-utils');

// ─── Data Transformation ────────────────────────────────────────────────────

/**
 * Build per-asset aggregate items from lots, disposals, and transfers.
 * Groups by asset, builds timeline events with FX conversion.
 */
export function buildAssetCostBasisItems(
  lots: AcquisitionLot[],
  disposals: LotDisposal[],
  lotTransfers: LotTransfer[],
  jurisdiction: string,
  currency: string,
  report?: {
    disposals: ConvertedLotDisposal[];
    lots: ConvertedAcquisitionLot[];
    lotTransfers: ConvertedLotTransfer[];
  }
): AssetCostBasisItem[] {
  // Build lot lookup
  const lotsMap = new Map<string, AcquisitionLot>();
  for (const lot of lots) {
    lotsMap.set(lot.id, lot);
  }

  // Build converted lookups (by ID)
  const convertedDisposalsMap = new Map<string, ConvertedLotDisposal>();
  const convertedLotsMap = new Map<string, ConvertedAcquisitionLot>();
  const convertedTransfersMap = new Map<string, ConvertedLotTransfer>();

  if (report) {
    for (const cd of report.disposals) {
      convertedDisposalsMap.set(cd.id, cd);
    }
    for (const cl of report.lots) {
      convertedLotsMap.set(cl.id, cl);
    }
    for (const ct of report.lotTransfers) {
      convertedTransfersMap.set(ct.id, ct);
    }
  }

  // Group lots by asset
  const assetLotsMap = new Map<string, AcquisitionLot[]>();
  for (const lot of lots) {
    const asset = lot.assetSymbol;
    const group = assetLotsMap.get(asset);
    if (group) {
      group.push(lot);
    } else {
      assetLotsMap.set(asset, [lot]);
    }
  }

  // Group disposals by asset (via lot's assetSymbol)
  const assetDisposalsMap = new Map<string, LotDisposal[]>();
  for (const disposal of disposals) {
    const lot = lotsMap.get(disposal.lotId);
    if (!lot) {
      logger.warn({ disposalId: disposal.id, lotId: disposal.lotId }, 'Disposal references missing lot');
      continue;
    }
    const asset = lot.assetSymbol;
    const group = assetDisposalsMap.get(asset);
    if (group) {
      group.push(disposal);
    } else {
      assetDisposalsMap.set(asset, [disposal]);
    }
  }

  // Group transfers by asset (via source lot's assetSymbol)
  const assetTransfersMap = new Map<string, LotTransfer[]>();
  for (const transfer of lotTransfers) {
    const sourceLot = lotsMap.get(transfer.sourceLotId);
    if (!sourceLot) {
      logger.warn({ transferId: transfer.id, sourceLotId: transfer.sourceLotId }, 'Transfer references missing lot');
      continue;
    }
    const asset = sourceLot.assetSymbol;
    const group = assetTransfersMap.get(asset);
    if (group) {
      group.push(transfer);
    } else {
      assetTransfersMap.set(asset, [transfer]);
    }
  }

  // Collect all assets that have any activity (lots, disposals, or transfers)
  const allAssets = new Set<string>([...assetLotsMap.keys(), ...assetDisposalsMap.keys(), ...assetTransfersMap.keys()]);

  // Build aggregate items
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

    // Build acquisition view items
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

    // Build disposal view items
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

      // US short/long-term tracking
      const isLongTerm = disposal.holdingPeriodDays > 365;
      if (isLongTerm) {
        longTermGainLoss = longTermGainLoss.plus(gainLoss);
        longTermCount++;
      } else {
        shortTermGainLoss = shortTermGainLoss.plus(gainLoss);
        shortTermCount++;
      }

      // Holding period stats
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

    // Build transfer view items
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
        quantity: formatCryptoQuantity(transfer.quantityTransferred),
        asset,
        costBasisPerUnit: costBasisPerUnit.toFixed(2),
        totalCostBasis: totalCostBasisTransfer.toFixed(2),
        sourceTransactionId: transfer.sourceTransactionId,
        targetTransactionId: transfer.targetTransactionId,
        sourceLotId: transfer.sourceLotId,
        sourceAcquisitionDate: sourceLot ? formatDateString(sourceLot.acquisitionDate) : 'unknown',
        feeUsdValue: transfer.metadata?.cryptoFeeUsdValue?.toFixed(2),
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
      avgHoldingDays: assetDisposals.length > 0 ? Math.round(totalHoldingDays / assetDisposals.length) : 0,
      shortestHoldingDays: shortestHolding === Infinity ? 0 : shortestHolding,
      longestHoldingDays: longestHolding,
      disposals: disposalViewItems,
      lots: acquisitionViewItems,
      transfers: transferViewItems,
    };

    // Add US-specific fields
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

// ─── Sorting ────────────────────────────────────────────────────────────────

/** Sort assets by absolute gain/loss descending (largest impact first) */
export function sortAssetsByAbsGainLoss(assets: AssetCostBasisItem[]): AssetCostBasisItem[] {
  return [...assets].sort((a, b) => {
    const absA = Math.abs(parseFloat(a.totalGainLoss));
    const absB = Math.abs(parseFloat(b.totalGainLoss));
    if (absB !== absA) return absB - absA;
    return a.asset.localeCompare(b.asset);
  });
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format a signed currency amount: +CAD 4,100.00 or -CAD 500.00
 */
export function formatSignedCurrency(amount: string, currency: string): string {
  const decimal = new Decimal(amount);
  const isNegative = decimal.isNegative();
  const absFormatted = decimal.abs().toFixed(2);

  // Add thousands separators
  const parts = absFormatted.split('.');
  if (parts[0]) {
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const withSeparators = parts.join('.');

  const sign = isNegative ? '-' : '+';
  return `${sign}${currency} ${withSeparators}`;
}

/**
 * Format an unsigned currency amount: CAD 4,100.00
 */
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
 * Format crypto quantity for display: max 8dp, trim trailing zeros (min 2dp), show <0.00000001 for dust
 *
 * Examples:
 * - 0.25000 → "0.25"
 * - 0.00000112 → "0.00000112"
 * - 0.0000000000001 → "<0.00000001"
 * - 0 → "0.00"
 */
export function formatCryptoQuantity(quantity: Decimal | string): string {
  const decimal = typeof quantity === 'string' ? new Decimal(quantity) : quantity;

  // Format with max 8 decimal places
  const formatted = decimal.toFixed(8);

  // Handle dust: original value was positive but rounds to zero at 8dp
  if (decimal.gt(0) && formatted === '0.00000000') {
    return '<0.00000001';
  }

  // Trim trailing zeros, but keep at least 2 decimal places
  const parts = formatted.split('.');
  if (parts[1]) {
    // Trim trailing zeros from decimal part
    const trimmed = parts[1].replace(/0+$/, '');
    // Ensure at least 2 decimal places
    const minDecimals = Math.max(trimmed.length, 2);
    return decimal.toFixed(minDecimals);
  }

  // No decimal part, use 2 decimal places
  return decimal.toFixed(2);
}

/**
 * Compute taxable amount based on jurisdiction rules.
 * Canada: 50% inclusion rate. US: full amount (short/long-term handled at display level).
 */
export function computeTaxableAmount(gainLoss: Decimal, jurisdiction: string): Decimal {
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
  let shortTerm = new Decimal(0);
  let longTerm = new Decimal(0);

  for (const asset of assets) {
    proceeds = proceeds.plus(asset.totalProceeds);
    costBasis = costBasis.plus(asset.totalCostBasis);
    gainLoss = gainLoss.plus(asset.totalGainLoss);
    if (asset.shortTermGainLoss) shortTerm = shortTerm.plus(asset.shortTermGainLoss);
    if (asset.longTermGainLoss) longTerm = longTerm.plus(asset.longTermGainLoss);
  }

  const taxable = computeTaxableAmount(gainLoss, jurisdiction);

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
