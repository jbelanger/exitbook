/**
 * Portfolio view TUI state types and factory functions.
 */

import type { Currency } from '@exitbook/core';

import type { SortMode, PortfolioPositionItem, PortfolioTransactionItem } from '../portfolio-types.js';

export type PortfolioPnlMode = 'unrealized' | 'realized' | 'both';

export interface PortfolioAssetsState {
  view: 'assets';

  asOf: string;
  method: string;
  jurisdiction: string;
  displayCurrency: Currency;

  positions: PortfolioPositionItem[];
  closedPositions: PortfolioPositionItem[];
  transactionsByAssetId: Map<string, PortfolioTransactionItem[]>;
  warnings: string[];

  totalTransactions: number;
  totalValue?: string | undefined;
  totalCost?: string | undefined;
  totalUnrealizedGainLoss?: string | undefined;
  totalUnrealizedPct?: string | undefined;
  totalRealizedGainLossAllTime?: string | undefined;
  totalNetFiatIn?: string | undefined;

  sortMode: SortMode;
  pnlMode: PortfolioPnlMode;

  selectedIndex: number;
  scrollOffset: number;
  error?: string | undefined;
}

export interface PortfolioHistoryState {
  view: 'history';

  assetId: string;
  assetSymbol: string;
  assetQuantity: string;
  displayCurrency: Currency;
  transactions: PortfolioTransactionItem[];

  selectedIndex: number;
  scrollOffset: number;

  parentState: PortfolioAssetsState;
  error?: string | undefined;
}

export type PortfolioState = PortfolioAssetsState | PortfolioHistoryState;

export type PortfolioAction =
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }
  | { type: 'CYCLE_SORT' }
  | { type: 'CYCLE_PNL_MODE' }
  | { type: 'DRILL_DOWN' }
  | { type: 'DRILL_UP' }
  | { type: 'CLEAR_ERROR' }
  | { error: string; type: 'SET_ERROR' };

export interface CreatePortfolioAssetsStateParams {
  asOf: string;
  method: string;
  jurisdiction: string;
  displayCurrency: Currency;
  positions: PortfolioPositionItem[];
  closedPositions?: PortfolioPositionItem[] | undefined;
  transactionsByAssetId: Map<string, PortfolioTransactionItem[]>;
  warnings?: string[] | undefined;
  totalTransactions: number;
  totalValue?: string | undefined;
  totalCost?: string | undefined;
  totalUnrealizedGainLoss?: string | undefined;
  totalUnrealizedPct?: string | undefined;
  totalRealizedGainLossAllTime?: string | undefined;
  totalNetFiatIn?: string | undefined;
}

export function createPortfolioAssetsState(params: CreatePortfolioAssetsStateParams): PortfolioAssetsState {
  return {
    view: 'assets',
    asOf: params.asOf,
    method: params.method,
    jurisdiction: params.jurisdiction,
    displayCurrency: params.displayCurrency,
    positions: params.positions,
    closedPositions: params.closedPositions ?? [],
    transactionsByAssetId: params.transactionsByAssetId,
    warnings: params.warnings ?? [],
    totalTransactions: params.totalTransactions,
    totalValue: params.totalValue,
    totalCost: params.totalCost,
    totalUnrealizedGainLoss: params.totalUnrealizedGainLoss,
    totalUnrealizedPct: params.totalUnrealizedPct,
    totalRealizedGainLossAllTime: params.totalRealizedGainLossAllTime,
    totalNetFiatIn: params.totalNetFiatIn,
    sortMode: 'value',
    pnlMode: 'unrealized',
    selectedIndex: 0,
    scrollOffset: 0,
  };
}

export function getVisiblePositions(state: PortfolioAssetsState): PortfolioPositionItem[] {
  if (state.pnlMode === 'unrealized') {
    return state.positions;
  }
  return [...state.positions, ...state.closedPositions];
}

export function createPortfolioHistoryState(
  asset: PortfolioPositionItem,
  parentState: PortfolioAssetsState,
  parentAssetIndex: number
): PortfolioHistoryState {
  return {
    view: 'history',
    assetId: asset.assetId,
    assetSymbol: asset.assetSymbol,
    assetQuantity: asset.quantity,
    displayCurrency: parentState.displayCurrency,
    transactions: parentState.transactionsByAssetId.get(asset.assetId) ?? [],
    selectedIndex: 0,
    scrollOffset: 0,
    parentState: {
      ...parentState,
      selectedIndex: parentAssetIndex,
      scrollOffset: parentState.scrollOffset,
    },
  };
}
