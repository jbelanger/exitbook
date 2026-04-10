/**
 * Cost basis view TUI state types, action types, and factory functions.
 */

import type {
  CostBasisJurisdiction,
  CostBasisMethod,
  FiatCurrency,
  StandardCostBasisFilingFacts,
} from '@exitbook/accounting/cost-basis';

import type { ListNavigationAction } from '../../../ui/shared/list-navigation.js';
import type { CostBasisReadinessWarning } from '../cost-basis-readiness.js';

type AcquisitionLotStatus = StandardCostBasisFilingFacts['acquisitions'][number]['status'];

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
  avgHoldingDays?: number | undefined;
  shortestHoldingDays?: number | undefined;
  longestHoldingDays?: number | undefined;
  hasHoldingPeriodData?: true | undefined;

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
  taxableGainLoss?: string | undefined;
  isGain: boolean;

  holdingPeriodDays?: number | undefined;
  taxTreatmentCategory?: string | undefined; // US only: 'short_term' | 'long_term'

  // Lot context
  acquisitionDate?: string | undefined;
  acquisitionTransactionId?: number | undefined;
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
  status: AcquisitionLotStatus;

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
  direction: 'in' | 'internal' | 'out';
  quantity: string;
  asset: string;

  costBasisPerUnit: string;
  totalCostBasis: string;
  marketValue?: string | undefined;

  sourceTransactionId?: number | undefined;
  targetTransactionId?: number | undefined;
  sourceLotId?: string | undefined;
  sourceAcquisitionDate?: string | undefined;

  feeAmount?: string | undefined;
  feeCurrency?: string | undefined;

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
  method: CostBasisMethod;
  jurisdiction: CostBasisJurisdiction;
  taxYear: number;
  currency: FiatCurrency;
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
  readinessWarnings: readonly CostBasisReadinessWarning[];
  totalDisposals: number;
  totalLots: number;

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
  currency: FiatCurrency;
  jurisdiction: CostBasisJurisdiction;
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
  | ListNavigationAction

  // Drill-down
  | { type: 'DRILL_DOWN' }
  | { type: 'DRILL_UP' }

  // Error handling
  | { type: 'CLEAR_ERROR' }
  | { error: string; type: 'SET_ERROR' };

// ─── Factory Functions ──────────────────────────────────────────────────────

export interface CalculationContext {
  calculationId: string;
  method: CostBasisMethod;
  jurisdiction: CostBasisJurisdiction;
  taxYear: number;
  currency: FiatCurrency;
  dateRange: { endDate: string; startDate: string };
}

export function createCostBasisAssetState(
  context: CalculationContext,
  assets: AssetCostBasisItem[],
  summary: CostBasisAssetState['summary'],
  options?: {
    readinessWarnings?: readonly CostBasisReadinessWarning[] | undefined;
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
    readinessWarnings: options?.readinessWarnings ?? [],
    totalDisposals: options?.totalDisposals ?? assets.reduce((sum, a) => sum + a.disposalCount, 0),
    totalLots: options?.totalLots ?? 0,
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
