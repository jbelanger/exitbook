/**
 * Portfolio domain types
 */

import type { Decimal } from 'decimal.js';

/**
 * Result from spot price fetch - either a price or an error
 */
export type SpotPriceResult = { price: Decimal } | { error: string };

export type SortMode = 'value' | 'gain' | 'loss' | 'allocation';

export interface OpenLotItem {
  lotId: string;
  quantity: string;
  remainingQuantity: string;
  costBasisPerUnit: string;
  acquisitionDate: string; // ISO 8601
  holdingDays: number;
}

export interface AccountBreakdownItem {
  accountId: number;
  platformKey: string;
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
  quantity: string;
}

export interface PortfolioPositionItem {
  assetId: string;
  /**
   * Underlying assetIds collapsed into this row (used for history drill-down).
   * Undefined means the row maps 1:1 to assetId.
   */
  sourceAssetIds?: string[] | undefined;
  assetSymbol: string;
  quantity: string;
  isNegative: boolean;
  isClosedPosition?: boolean | undefined;

  // Pricing (undefined when unavailable)
  spotPricePerUnit?: string | undefined;
  currentValue?: string | undefined;
  allocationPct?: string | undefined;
  priceStatus: 'ok' | 'unavailable';
  priceError?: string | undefined;

  // Cost basis (undefined when no open lots)
  totalCostBasis?: string | undefined;
  avgCostPerUnit?: string | undefined;
  unrealizedGainLoss?: string | undefined;
  unrealizedPct?: string | undefined;
  realizedGainLossAllTime?: string | undefined;

  // Open lots from cost basis engine
  openLots: OpenLotItem[];

  // Per-account breakdown
  accountBreakdown: AccountBreakdownItem[];
}
