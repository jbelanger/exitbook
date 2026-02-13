/**
 * Cost basis view TUI state types, action types, and factory functions.
 */

// ─── Display Items ──────────────────────────────────────────────────────────

/** Per-asset aggregate in the asset summary list */
export interface AssetCostBasisItem {
  asset: string;
  disposalCount: number;
  totalProceeds: string;
  totalCostBasis: string;
  totalGainLoss: string;
  totalTaxableGainLoss: string;
  isGain: boolean;

  // US jurisdiction — short/long-term split
  shortTermGainLoss?: string | undefined;
  shortTermCount?: number | undefined;
  longTermGainLoss?: string | undefined;
  longTermCount?: number | undefined;

  // Holding period stats
  avgHoldingDays: number;
  shortestHoldingDays: number;
  longestHoldingDays: number;

  // Disposal data for drill-down
  disposals: DisposalViewItem[];
}

/** Individual disposal in the disposal drill-down list */
export interface DisposalViewItem {
  id: string;
  disposalDate: string;
  quantityDisposed: string;
  asset: string;

  proceedsPerUnit: string;
  totalProceeds: string;
  costBasisPerUnit: string;
  totalCostBasis: string;
  gainLoss: string;
  isGain: boolean;

  holdingPeriodDays: number;
  taxTreatmentCategory?: string | undefined; // US only: 'short_term' | 'long_term'

  // Lot context
  acquisitionDate: string;
  acquisitionTransactionId: number;
  disposalTransactionId: number;

  // FX conversion (non-USD currency)
  fxConversion?:
    | {
        fxRate: string;
        fxSource: string;
      }
    | undefined;
}

// ─── State Types ────────────────────────────────────────────────────────────

/** Asset summary level (Level 1) */
export interface CostBasisAssetState {
  view: 'assets';

  // Calculation context
  calculationId: string;
  method: string;
  jurisdiction: string;
  taxYear: number;
  currency: string;
  dateRange: { endDate: string; startDate: string };

  // Financial summary
  summary: {
    longTermGainLoss?: string | undefined;
    shortTermGainLoss?: string | undefined;
    totalCostBasis: string;
    totalGainLoss: string;
    totalProceeds: string;
    totalTaxableGainLoss: string;
  };

  // Per-asset aggregates
  assets: AssetCostBasisItem[];
  totalDisposals: number;
  totalLots: number;

  // Warning
  missingPricesWarning?: string | undefined;

  // Calculation errors (partial failure — some assets failed)
  calculationErrors?: { asset: string; error: string }[] | undefined;

  // Navigation
  selectedIndex: number;
  scrollOffset: number;
  error?: string | undefined;
}

/** Disposal list level (Level 2 — drill-down) */
export interface CostBasisDisposalState {
  view: 'disposals';

  // Asset context
  asset: string;
  currency: string;
  jurisdiction: string;
  assetTotalGainLoss: string;
  assetDisposalCount: number;

  // Disposal items
  disposals: DisposalViewItem[];

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Drill-down context (cursor position to restore)
  parentState: CostBasisAssetState;

  error?: string | undefined;
}

export type CostBasisState = CostBasisAssetState | CostBasisDisposalState;

// ─── Actions ────────────────────────────────────────────────────────────────

export type CostBasisAction =
  // Navigation (both views)
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }

  // Drill-down
  | { type: 'DRILL_DOWN' }
  | { type: 'DRILL_UP' }

  // Error handling
  | { type: 'CLEAR_ERROR' }
  | { error: string; type: 'SET_ERROR' };

// ─── Factory Functions ──────────────────────────────────────────────────────

export interface CalculationContext {
  calculationId: string;
  method: string;
  jurisdiction: string;
  taxYear: number;
  currency: string;
  dateRange: { endDate: string; startDate: string };
}

export function createCostBasisAssetState(
  context: CalculationContext,
  assets: AssetCostBasisItem[],
  summary: CostBasisAssetState['summary'],
  options?: {
    calculationErrors?: { asset: string; error: string }[] | undefined;
    missingPricesWarning?: string | undefined;
    totalDisposals?: number | undefined;
    totalLots?: number | undefined;
  }
): CostBasisAssetState {
  return {
    view: 'assets',
    calculationId: context.calculationId,
    method: context.method,
    jurisdiction: context.jurisdiction,
    taxYear: context.taxYear,
    currency: context.currency,
    dateRange: context.dateRange,
    summary,
    assets,
    totalDisposals: options?.totalDisposals ?? assets.reduce((sum, a) => sum + a.disposalCount, 0),
    totalLots: options?.totalLots ?? 0,
    missingPricesWarning: options?.missingPricesWarning,
    calculationErrors: options?.calculationErrors,
    selectedIndex: 0,
    scrollOffset: 0,
  };
}

export function createCostBasisDisposalState(
  assetItem: AssetCostBasisItem,
  parentState: CostBasisAssetState,
  parentAssetIndex: number
): CostBasisDisposalState {
  return {
    view: 'disposals',
    asset: assetItem.asset,
    currency: parentState.currency,
    jurisdiction: parentState.jurisdiction,
    assetTotalGainLoss: assetItem.totalGainLoss,
    assetDisposalCount: assetItem.disposalCount,
    disposals: assetItem.disposals,
    selectedIndex: 0,
    scrollOffset: 0,
    parentState: { ...parentState, selectedIndex: parentAssetIndex, scrollOffset: parentState.scrollOffset },
  };
}
