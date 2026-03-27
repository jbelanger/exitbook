import type { CommonViewFilters } from '../shared/view-utils.js';

/**
 * Parameters for view prices command.
 */
export interface ViewPricesParams extends Omit<CommonViewFilters, 'source'> {
  platform?: string | undefined;
  asset?: string | undefined;
  missingOnly?: boolean | undefined;
}

/**
 * Price coverage info for a single asset.
 */
export interface PriceCoverageInfo {
  assetSymbol: string;
  total_transactions: number;
  with_price: number;
  missing_price: number;
  coverage_percentage: number;
}

/**
 * Enhanced coverage with source breakdown for TUI detail panel.
 */
export interface PriceCoverageDetail extends PriceCoverageInfo {
  sources: { count: number; name: string }[];
  missingSources: { count: number; name: string }[];
  dateRange: { earliest: string; latest: string };
}

/**
 * A single movement row missing price data.
 */
export interface MissingPriceMovement {
  transactionId: number;
  source: string;
  datetime: string;
  assetSymbol: string;
  amount: string;
  direction: 'inflow' | 'outflow';
  operationCategory?: string | undefined;
  operationType?: string | undefined;
  resolvedPrice?: string | undefined;
}

/**
 * Per-asset summary in missing mode.
 */
export interface AssetBreakdownEntry {
  assetSymbol: string;
  count: number;
  sources: { count: number; name: string }[];
}

/**
 * Result of view prices command.
 */
export interface ViewPricesResult {
  coverage: PriceCoverageInfo[];
  summary: {
    missing_price: number;
    overall_coverage_percentage: number;
    total_transactions: number;
    with_price: number;
  };
}

export function formatCoveragePercentage(percentage: number): string {
  return `${percentage.toFixed(1)}%`;
}
