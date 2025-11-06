import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { AcquisitionLot, LotDisposal } from '../domain/schemas.js';
import type { IJurisdictionRules } from '../jurisdictions/base-rules.js';

import type { AssetGainLossSummary, DisposalGainLoss, GainLossResult } from './gain-loss-calculator.js';
import type { AssetLotMatchResult } from './lot-matcher.js';

/**
 * Calculate gains/losses with jurisdiction-specific tax treatment
 *
 * @param assetResults - Asset-grouped lot match results from LotMatcher
 * @param rules - Jurisdiction-specific tax rules
 * @returns Result containing gain/loss summary
 */
export function calculateGainLoss(
  assetResults: AssetLotMatchResult[],
  rules: IJurisdictionRules
): Result<GainLossResult, Error> {
  try {
    // Process each asset
    const assetSummaries = new Map<string, AssetGainLossSummary>();
    let totalDisallowedLosses = 0;

    for (const assetResult of assetResults) {
      const { asset, lots, disposals } = assetResult;

      // Skip assets with no lots and no disposals (e.g., fiat currencies)
      if (lots.length === 0 && disposals.length === 0) {
        continue;
      }

      // Build lot lookup map for this asset
      const lotMap = new Map(lots.map((lot) => [lot.id, lot]));

      // Calculate gain/loss for each disposal with tax treatment
      const disposalGainLosses: DisposalGainLoss[] = [];

      for (const disposal of disposals) {
        const lot = lotMap.get(disposal.lotId);
        if (!lot) {
          return err(new Error(`Lot ${disposal.lotId} not found for disposal ${disposal.id}`));
        }

        // Check for loss disallowance (superficial loss / wash sale)
        const lossDisallowed = checkLossDisallowance(disposal, lot, disposals, lots, rules);

        // Calculate taxable gain/loss
        const capitalGainLoss = disposal.gainLoss;
        const taxableGainLoss = lossDisallowed
          ? disposal.gainLoss.times(0) // Disallowed losses don't count for tax purposes
          : rules.calculateTaxableGain(capitalGainLoss, disposal.holdingPeriodDays);

        // Get tax treatment category
        const taxTreatmentCategory = rules.classifyGain(disposal.holdingPeriodDays);

        // Update disposal with tax treatment category for persistence
        disposal.taxTreatmentCategory = taxTreatmentCategory;

        disposalGainLosses.push({
          disposalId: disposal.id,
          asset,
          disposalDate: disposal.disposalDate,
          acquisitionDate: lot.acquisitionDate,
          holdingPeriodDays: disposal.holdingPeriodDays,
          capitalGainLoss,
          taxableGainLoss,
          taxTreatmentCategory,
          lossDisallowed,
          quantityDisposed: disposal.quantityDisposed,
          proceedsPerUnit: disposal.proceedsPerUnit,
          costBasisPerUnit: disposal.costBasisPerUnit,
        });

        if (lossDisallowed) {
          totalDisallowedLosses++;
        }
      }

      // Aggregate by asset
      const summaryResult = aggregateAssetGainLoss(asset, disposalGainLosses);
      if (summaryResult.isErr()) {
        return err(summaryResult.error);
      }
      assetSummaries.set(asset, summaryResult.value);
    }

    // Aggregate across all assets
    const result = aggregateOverallGainLoss(assetSummaries, totalDisallowedLosses);
    if (result.isErr()) {
      return err(result.error);
    }

    return ok(result.value);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Check if a capital loss is disallowed due to superficial loss / wash sale rules
 *
 * @param disposal - Current disposal being evaluated
 * @param _lot - Acquisition lot for the disposal (unused - kept for future use)
 * @param _allAssetDisposals - All disposals for this asset (unused - kept for future use)
 * @param allAssetLots - All lots for this asset (to find reacquisition dates)
 * @param rules - Jurisdiction rules
 * @returns true if loss is disallowed, false otherwise
 */
export function checkLossDisallowance(
  disposal: LotDisposal,
  _lot: AcquisitionLot,
  _allAssetDisposals: LotDisposal[],
  allAssetLots: AcquisitionLot[],
  rules: IJurisdictionRules
): boolean {
  // Only check if this is a loss
  if (disposal.gainLoss.gte(0)) {
    return false;
  }

  // Calculate the maximum window we need to check
  // Canada: 30 days before + 30 days after = 61 days total window
  // US: 30 days after only, but we use 61 to be safe for all jurisdictions
  const maxWindowDays = 61;
  const windowStart = new Date(disposal.disposalDate);
  windowStart.setDate(windowStart.getUTCDate() - maxWindowDays);
  const windowEnd = new Date(disposal.disposalDate);
  windowEnd.setDate(windowEnd.getUTCDate() + maxWindowDays);

  // Filter to only lots acquired near the disposal date
  const reacquisitionDates = allAssetLots
    .filter((otherLot) => {
      if (otherLot.id === disposal.lotId) {
        return false; // Skip the lot being disposed
      }
      const acqDate = otherLot.acquisitionDate;
      return acqDate >= windowStart && acqDate <= windowEnd;
    })
    .map((lot) => lot.acquisitionDate);

  return rules.isLossDisallowed(disposal.disposalDate, reacquisitionDates);
}

/**
 * Aggregate gain/loss for a single asset
 */
export function aggregateAssetGainLoss(
  asset: string,
  disposals: DisposalGainLoss[]
): Result<AssetGainLossSummary, Error> {
  // Handle case where there are no disposals (asset only acquired, never sold)
  if (disposals.length === 0) {
    return ok({
      asset,
      totalProceeds: new Decimal(0),
      totalCostBasis: new Decimal(0),
      totalCapitalGainLoss: new Decimal(0),
      totalTaxableGainLoss: new Decimal(0),
      disposalCount: 0,
      byCategory: new Map(),
      disposals: [],
    });
  }

  const firstDisposal = disposals[0];
  if (!firstDisposal) {
    return err(new Error(`Cannot access first disposal for asset ${asset}`));
  }

  // Start with zero Decimals from first disposal
  const zero = firstDisposal.capitalGainLoss.times(0);

  let totalProceeds = zero;
  let totalCostBasis = zero;
  let totalCapitalGainLoss = zero;
  let totalTaxableGainLoss = zero;

  const byCategory = new Map<string, { count: number; gainLoss: Decimal; taxableGainLoss: Decimal }>();

  for (const disposal of disposals) {
    const proceeds = disposal.proceedsPerUnit.times(disposal.quantityDisposed);
    const costBasis = disposal.costBasisPerUnit.times(disposal.quantityDisposed);

    totalProceeds = totalProceeds.plus(proceeds);
    totalCostBasis = totalCostBasis.plus(costBasis);
    totalCapitalGainLoss = totalCapitalGainLoss.plus(disposal.capitalGainLoss);
    totalTaxableGainLoss = totalTaxableGainLoss.plus(disposal.taxableGainLoss);

    // Aggregate by category
    const category = disposal.taxTreatmentCategory ?? 'uncategorized';
    const existing = byCategory.get(category) ?? {
      count: 0,
      gainLoss: disposal.capitalGainLoss.times(0),
      taxableGainLoss: disposal.taxableGainLoss.times(0),
    };

    byCategory.set(category, {
      count: existing.count + 1,
      gainLoss: existing.gainLoss.plus(disposal.capitalGainLoss),
      taxableGainLoss: existing.taxableGainLoss.plus(disposal.taxableGainLoss),
    });
  }

  return ok({
    asset,
    totalProceeds,
    totalCostBasis,
    totalCapitalGainLoss,
    totalTaxableGainLoss,
    disposalCount: disposals.length,
    byCategory,
    disposals,
  });
}

/**
 * Aggregate gain/loss across all assets
 */
export function aggregateOverallGainLoss(
  assetSummaries: Map<string, AssetGainLossSummary>,
  disallowedLossCount: number
): Result<GainLossResult, Error> {
  // Handle case where there are no crypto assets (e.g., fiat-only transactions)
  // This is valid - return zeroed summary instead of error
  if (assetSummaries.size === 0) {
    return ok({
      byAsset: new Map(),
      totalProceeds: new Decimal(0),
      totalCostBasis: new Decimal(0),
      totalCapitalGainLoss: new Decimal(0),
      totalTaxableGainLoss: new Decimal(0),
      totalDisposalsProcessed: 0,
      disallowedLossCount: 0,
    });
  }

  // Get zero Decimal from first summary
  const firstSummary = assetSummaries.values().next().value;
  if (!firstSummary) {
    return err(new Error('Cannot access first asset summary'));
  }

  const zero = firstSummary.totalProceeds.times(0);

  let totalProceeds = zero;
  let totalCostBasis = zero;
  let totalCapitalGainLoss = zero;
  let totalTaxableGainLoss = zero;
  let totalDisposalsProcessed = 0;

  for (const summary of assetSummaries.values()) {
    totalProceeds = totalProceeds.plus(summary.totalProceeds);
    totalCostBasis = totalCostBasis.plus(summary.totalCostBasis);
    totalCapitalGainLoss = totalCapitalGainLoss.plus(summary.totalCapitalGainLoss);
    totalTaxableGainLoss = totalTaxableGainLoss.plus(summary.totalTaxableGainLoss);
    totalDisposalsProcessed += summary.disposalCount;
  }

  return ok({
    byAsset: assetSummaries,
    totalProceeds,
    totalCostBasis,
    totalCapitalGainLoss,
    totalTaxableGainLoss,
    totalDisposalsProcessed,
    disallowedLossCount,
  });
}
