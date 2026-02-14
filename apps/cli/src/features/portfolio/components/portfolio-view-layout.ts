/**
 * Layout constants and helpers for portfolio TUI rows.
 */

import { calculateChromeLines, calculateVisibleRows, conditionalLines } from '../../../ui/shared/chrome-layout.js';
import type { PortfolioPositionItem } from '../portfolio-types.js';

import type { PortfolioAssetsState, PortfolioPnlMode } from './portfolio-view-state.js';
import { getVisiblePositions } from './portfolio-view-state.js';

const PORTFOLIO_HISTORY_CHROME_LINES = 16;
const PORTFOLIO_LIST_SCROLL_INDICATOR_RESERVE_LINES = 2;

export interface PortfolioAssetsLayout {
  hiddenOpenLots: number;
  listVisibleRows: number;
  openLotsVisibleRows: number;
}

export function getPortfolioAssetsLayout(terminalHeight: number, state: PortfolioAssetsState): PortfolioAssetsLayout {
  const selected = getVisiblePositions(state)[state.selectedIndex];
  const totalOpenLots = getOpenLotsRows(selected);
  const chromeLines = calculatePortfolioAssetsChromeLinesWithoutOpenLots(state, selected);
  const availableRows = calculateVisibleRows(terminalHeight, chromeLines);

  if (totalOpenLots === 0) {
    return {
      hiddenOpenLots: 0,
      listVisibleRows: availableRows,
      openLotsVisibleRows: 0,
    };
  }

  // Keep at least one row for the top list and use the remainder for open lots.
  const maxLotSectionRows = Math.max(0, availableRows - 1);
  if (maxLotSectionRows === 0) {
    return {
      hiddenOpenLots: totalOpenLots,
      listVisibleRows: availableRows,
      openLotsVisibleRows: 0,
    };
  }

  if (totalOpenLots <= maxLotSectionRows) {
    return {
      hiddenOpenLots: 0,
      listVisibleRows: Math.max(1, availableRows - totalOpenLots),
      openLotsVisibleRows: totalOpenLots,
    };
  }

  if (maxLotSectionRows === 1) {
    return {
      hiddenOpenLots: totalOpenLots,
      listVisibleRows: Math.max(1, availableRows - 1),
      openLotsVisibleRows: 0,
    };
  }

  const openLotsVisibleRows = maxLotSectionRows - 1;
  return {
    hiddenOpenLots: totalOpenLots - openLotsVisibleRows,
    listVisibleRows: Math.max(1, availableRows - maxLotSectionRows),
    openLotsVisibleRows,
  };
}

export function getPortfolioAssetsVisibleRows(terminalHeight: number, state: PortfolioAssetsState): number {
  return getPortfolioAssetsLayout(terminalHeight, state).listVisibleRows;
}

export function getPortfolioHistoryVisibleRows(terminalHeight: number): number {
  return calculateVisibleRows(terminalHeight, PORTFOLIO_HISTORY_CHROME_LINES);
}

function calculatePortfolioAssetsChromeLinesWithoutOpenLots(
  state: PortfolioAssetsState,
  selected: PortfolioPositionItem | undefined
): number {
  return calculateChromeLines({
    beforeHeader: 1,
    header: getHeaderLines(state),
    beforeList: 1,
    listScrollIndicators: PORTFOLIO_LIST_SCROLL_INDICATOR_RESERVE_LINES,
    divider: 1,
    detail: selected ? getAssetDetailLinesWithoutOpenLots(selected, state.pnlMode) : 0,
    error: conditionalLines(Boolean(state.error), 1),
    beforeControls: 1,
    controls: 1,
  });
}

function getHeaderLines(state: PortfolioAssetsState): number {
  const visiblePositions = getVisiblePositions(state);
  const pricedNonNegative = visiblePositions.filter(
    (position) => position.priceStatus === 'ok' && !position.isNegative
  ).length;
  const showUnrealized = state.pnlMode !== 'realized';
  const showRealized = state.pnlMode !== 'unrealized';

  let lines = 1;

  if (state.warnings.length > 0) {
    lines += state.warnings.length;
  }

  if (state.totalNetFiatIn !== undefined) {
    lines += 1;
  }

  if (pricedNonNegative === 0) {
    if (showRealized && state.totalRealizedGainLossAllTime !== undefined) {
      lines += 1;
    }
    return lines;
  }

  if (state.totalCost !== undefined || showUnrealized) {
    lines += 1;
  }

  if (showRealized) {
    lines += 1;
  }

  return lines;
}

function getAssetDetailLinesWithoutOpenLots(selected: PortfolioPositionItem, pnlMode: PortfolioPnlMode): number {
  let lines = 0;

  // Title row + blank line.
  lines += 1;
  lines += 1;

  if (selected.isClosedPosition === true) {
    lines += 1;
    lines += 1;
    lines += 1;
    lines += 1;
    lines += 1;
    return lines;
  }

  if (selected.priceStatus === 'unavailable' || selected.spotPricePerUnit === undefined) {
    lines += 1;
    lines += 1;
    lines += 1;
    lines += 1;
    lines += 1;
    return lines;
  }

  if (selected.isNegative) {
    lines += 1;
    lines += 1;
    lines += 1;
    lines += 1;
    lines += 1;
    return lines;
  }

  lines += 1;

  const showUnrealized = pnlMode !== 'realized';
  const showRealized = pnlMode !== 'unrealized';

  if (
    selected.openLots.length === 0 ||
    selected.totalCostBasis === undefined ||
    selected.unrealizedGainLoss === undefined
  ) {
    lines += 1;
    if (showRealized) {
      lines += 1;
    }
  } else {
    lines += 1;
    lines += conditionalLines(showUnrealized, 1);
    lines += conditionalLines(showRealized, 1);
    lines += 1;
    lines += 1;
  }

  lines += 1;
  lines += 1;
  lines += 1;

  return lines;
}

function getOpenLotsRows(selected: PortfolioPositionItem | undefined): number {
  if (!selected) {
    return 0;
  }
  if (selected.isClosedPosition === true || selected.isNegative) {
    return 0;
  }
  if (selected.priceStatus === 'unavailable' || selected.spotPricePerUnit === undefined) {
    return 0;
  }
  if (selected.totalCostBasis === undefined || selected.unrealizedGainLoss === undefined) {
    return 0;
  }
  return selected.openLots.length;
}
