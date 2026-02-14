/**
 * Portfolio domain types
 */

import type { Decimal } from 'decimal.js';

/**
 * Result from spot price fetch - either a price or an error
 */
export type SpotPriceResult = { price: Decimal } | { error: string };

/**
 * Sort modes for portfolio view
 */
export type SortMode = 'value' | 'gain' | 'loss' | 'allocation';

/**
 * Open lot item for display
 */
export interface OpenLotItem {
  lotId: string;
  quantity: string;
  remainingQuantity: string;
  costBasisPerUnit: string;
  acquisitionDate: string; // ISO 8601
  holdingDays: number;
}

/**
 * Per-account breakdown of holdings
 */
export interface AccountBreakdownItem {
  accountId: number;
  sourceName: string;
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
  quantity: string;
}

/**
 * Portfolio position (single asset)
 */
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

/**
 * Transaction item for Level 2 history view
 */
export interface PortfolioTransactionItem {
  id: number;
  datetime: string; // ISO 8601
  operationCategory: string;
  operationType: string;
  sourceName: string;

  // Movement of the drilled asset (signed quantity)
  assetAmount: string;
  assetDirection: 'in' | 'out';

  // Fiat value at transaction time (undefined if no price data)
  fiatValue?: string | undefined;

  // Transfer context (undefined for non-transfers)
  transferPeer?: string | undefined; // e.g., "solana blockchain" or "kraken"
  transferDirection?: 'to' | 'from' | undefined;

  // All movements (for detail panel)
  inflows: { amount: string; assetSymbol: string }[];
  outflows: { amount: string; assetSymbol: string }[];
  fees: { amount: string; assetSymbol: string }[];
}
