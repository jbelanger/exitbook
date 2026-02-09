/**
 * Cost basis view pure utility functions.
 */

import type { AcquisitionLot, LotDisposal } from '@exitbook/accounting';
import type { ConvertedLotDisposal } from '@exitbook/accounting';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import type { AssetCostBasisItem, DisposalViewItem } from './cost-basis-view-state.js';

const logger = getLogger('cost-basis-view-utils');

// ─── Data Transformation ────────────────────────────────────────────────────

/**
 * Build per-asset aggregate items from lots and disposals.
 * Groups disposals by asset (via lot join), computes aggregates.
 */
export function buildAssetCostBasisItems(
  lots: AcquisitionLot[],
  disposals: LotDisposal[],
  jurisdiction: string,
  currency: string,
  report?: { disposals: ConvertedLotDisposal[] }  
): AssetCostBasisItem[] {
  // Build lot lookup
  const lotsMap = new Map<string, AcquisitionLot>();
  for (const lot of lots) {
    lotsMap.set(lot.id, lot);
  }

  // Build converted disposal lookup (by disposal ID)
  const convertedMap = new Map<string, ConvertedLotDisposal>();
  if (report) {
    for (const cd of report.disposals) {
      convertedMap.set(cd.id, cd);
    }
  }

  // Group disposals by asset (via lot's assetSymbol)
  const assetGroups = new Map<string, LotDisposal[]>();
  for (const disposal of disposals) {
    const lot = lotsMap.get(disposal.lotId);
    if (!lot) {
      logger.warn({ disposalId: disposal.id, lotId: disposal.lotId }, 'Disposal references missing lot');
      continue;
    }
    const asset = lot.assetSymbol;
    const group = assetGroups.get(asset);
    if (group) {
      group.push(disposal);
    } else {
      assetGroups.set(asset, [disposal]);
    }
  }

  // Build aggregate items
  const items: AssetCostBasisItem[] = [];

  for (const [asset, assetDisposals] of assetGroups) {
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

    const disposalViewItems: DisposalViewItem[] = [];

    for (const disposal of assetDisposals) {
      const converted = convertedMap.get(disposal.id);
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

      // Build disposal view item
      const lot = lotsMap.get(disposal.lotId);
      disposalViewItems.push({
        id: disposal.id,
        disposalDate: formatDateString(disposal.disposalDate),
        quantityDisposed: disposal.quantityDisposed.toFixed(),
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

    const totalTaxableGainLoss = computeTaxableAmount(totalGainLoss, jurisdiction);

    // Sort disposals by date ascending
    disposalViewItems.sort((a, b) => a.disposalDate.localeCompare(b.disposalDate));

    const item: AssetCostBasisItem = {
      asset,
      disposalCount: assetDisposals.length,
      totalProceeds: totalProceeds.toFixed(2),
      totalCostBasis: totalCostBasis.toFixed(2),
      totalGainLoss: totalGainLoss.toFixed(2),
      totalTaxableGainLoss: totalTaxableGainLoss.toFixed(2),
      isGain: totalGainLoss.gte(0),
      avgHoldingDays: assetDisposals.length > 0 ? Math.round(totalHoldingDays / assetDisposals.length) : 0,
      shortestHoldingDays: shortestHolding === Infinity ? 0 : shortestHolding,
      longestHoldingDays: longestHolding,
      disposals: disposalViewItems,
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
