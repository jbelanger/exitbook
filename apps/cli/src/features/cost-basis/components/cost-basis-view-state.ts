/**
 * Cost basis view TUI state types, action types, and factory functions.
 */

// ─── Display Items ──────────────────────────────────────────────────────────

/** Per-asset aggregate in the asset summary list */
export interface AssetCostBasisItem {
  asset: string;
  disposalCount: number;
  lotCount: number;
  transferCount: number;
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

  // Timeline data for drill-down
  disposals: DisposalViewItem[];
  lots: AcquisitionViewItem[];
  transfers: TransferViewItem[];
}

/** Individual disposal in the timeline */
export interface DisposalViewItem {
  type: 'disposal';
  id: string;
  date: string; // YYYY-MM-DD for display
  sortTimestamp: string; // Full ISO timestamp for ordering
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

/** Individual acquisition lot in the timeline */
export interface AcquisitionViewItem {
  type: 'acquisition';
  id: string;
  date: string; // YYYY-MM-DD for display
  sortTimestamp: string; // Full ISO timestamp for ordering
  quantity: string;
  asset: string;

  costBasisPerUnit: string;
  totalCostBasis: string;

  transactionId: number;
  lotId: string;
  remainingQuantity: string;
  status: string; // 'open' | 'partially_disposed' | 'fully_disposed'

  // FX conversion (non-USD currency)
  fxConversion?:
    | {
        fxRate: string;
        fxSource: string;
      }
    | undefined;
  fxUnavailable?: true | undefined;
  /** Original currency when fxUnavailable (always 'USD') */
  originalCurrency?: string | undefined;
}

/** Individual lot transfer in the timeline */
export interface TransferViewItem {
  type: 'transfer';
  id: string;
  date: string; // YYYY-MM-DD for display
  sortTimestamp: string; // Full ISO timestamp for ordering
  quantity: string;
  asset: string;

  costBasisPerUnit: string;
  totalCostBasis: string;

  sourceTransactionId: number;
  targetTransactionId: number;
  sourceLotId: string;
  sourceAcquisitionDate: string;

  feeUsdValue?: string | undefined;

  // FX conversion (non-USD currency)
  fxConversion?:
    | {
        fxRate: string;
        fxSource: string;
      }
    | undefined;
  fxUnavailable?: true | undefined;
  /** Original currency when fxUnavailable (always 'USD') */
  originalCurrency?: string | undefined;
}

/** Union of all timeline event types */
export type TimelineEvent = AcquisitionViewItem | DisposalViewItem | TransferViewItem;

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

/** Timeline level (Level 2 — drill-down) */
export interface CostBasisTimelineState {
  view: 'timeline';

  // Asset context
  asset: string;
  currency: string;
  jurisdiction: string;
  assetTotalGainLoss: string;
  assetLotCount: number;
  assetDisposalCount: number;
  assetTransferCount: number;

  // Timeline events
  events: TimelineEvent[];

  // Navigation
  selectedIndex: number;
  scrollOffset: number;

  // Drill-down context (cursor position to restore)
  parentState: CostBasisAssetState;

  error?: string | undefined;
}

export type CostBasisState = CostBasisAssetState | CostBasisTimelineState;

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

export function createCostBasisTimelineState(
  assetItem: AssetCostBasisItem,
  parentState: CostBasisAssetState,
  parentAssetIndex: number
): CostBasisTimelineState {
  // Combine all events and sort by timestamp
  const events: TimelineEvent[] = [...assetItem.lots, ...assetItem.disposals, ...assetItem.transfers].sort((a, b) => {
    // Primary sort: timestamp
    const timestampCompare = a.sortTimestamp.localeCompare(b.sortTimestamp);
    if (timestampCompare !== 0) return timestampCompare;

    // Secondary sort (same timestamp): acquisition < transfer < disposal
    const typeOrder = { acquisition: 0, transfer: 1, disposal: 2 };
    return typeOrder[a.type] - typeOrder[b.type];
  });

  return {
    view: 'timeline',
    asset: assetItem.asset,
    currency: parentState.currency,
    jurisdiction: parentState.jurisdiction,
    assetTotalGainLoss: assetItem.totalGainLoss,
    assetLotCount: assetItem.lotCount,
    assetDisposalCount: assetItem.disposalCount,
    assetTransferCount: assetItem.transferCount,
    events,
    selectedIndex: 0,
    scrollOffset: 0,
    parentState: { ...parentState, selectedIndex: parentAssetIndex, scrollOffset: parentState.scrollOffset },
  };
}
