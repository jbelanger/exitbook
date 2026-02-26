/**
 * Portfolio view TUI components.
 */

import { Decimal } from 'decimal.js';
import { Box, Text, useInput, useStdout } from 'ink';
import { useReducer, type FC } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  type Columns,
  createColumns,
  conditionalLines,
  Divider,
  getSelectionCursor,
} from '../../../ui/shared/index.js';
import { formatCryptoQuantity } from '../../cost-basis/components/index.js';
import type { PortfolioPositionItem, PortfolioTransactionItem } from '../portfolio-types.js';

import { portfolioViewReducer, handlePortfolioKeyboardInput } from './portfolio-view-controller.js';
import {
  getVisiblePositions,
  type PortfolioAssetsState,
  type PortfolioHistoryState,
  type PortfolioPnlMode,
} from './portfolio-view-state.js';

// ─── Layout Logic ────────────────────────────────────────────────────────────

const PORTFOLIO_HISTORY_CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Transaction History"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: 7, // transaction detail panel
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

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

// ─── Components ──────────────────────────────────────────────────────────────

export const PortfolioApp: FC<{
  initialState: PortfolioAssetsState;
  onQuit: () => void;
}> = ({ initialState, onQuit }) => {
  const [state, dispatch] = useReducer(portfolioViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  useInput((input, key) => {
    handlePortfolioKeyboardInput(
      input,
      { ...key, backspace: key.backspace ?? false, return: key.return ?? false },
      state,
      dispatch,
      onQuit,
      terminalHeight
    );
  });

  if (state.view === 'assets') {
    return (
      <PortfolioAssetsView
        state={state}
        terminalHeight={terminalHeight}
        terminalWidth={terminalWidth}
      />
    );
  }

  return (
    <PortfolioHistoryView
      state={state}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
    />
  );
};

const PortfolioAssetsView: FC<{
  state: PortfolioAssetsState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  if (getVisiblePositions(state).length === 0) {
    return <PortfolioAssetsEmptyState state={state} />;
  }
  const layout = getPortfolioAssetsLayout(terminalHeight, state);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <PortfolioHeader state={state} />
      {state.warnings.map((warning) => (
        <Text
          key={warning}
          color="yellow"
        >
          {'  '}
          {'\u26A0'} {warning}
        </Text>
      ))}
      <Text> </Text>
      <PortfolioAssetsList
        state={state}
        visibleRows={layout.listVisibleRows}
      />
      <Divider width={terminalWidth} />
      <PortfolioAssetDetail
        state={state}
        openLotsVisibleRows={layout.openLotsVisibleRows}
        hiddenOpenLots={layout.hiddenOpenLots}
      />
      {state.error && (
        <Text color="red">
          {'  '}
          {state.error}
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>{'↑↓/j/k · ^U/^D page · Home/End · s sort · r pnl · enter history · q/esc quit'}</Text>
    </Box>
  );
};

const PortfolioAssetsEmptyState: FC<{ state: PortfolioAssetsState }> = ({ state }) => {
  const asOfDate = state.asOf.split('T')[0] ?? state.asOf;

  if (state.totalTransactions === 0) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text bold>Portfolio</Text> 0 <Text dimColor>assets</Text>
        </Text>
        <Text> </Text>
        <Text>{'  '}No transactions found.</Text>
        <Text> </Text>
        <Text>{'  '}Import data to create accounts:</Text>
        <Text dimColor>{'  '}exitbook import --exchange kucoin --csv-dir ./exports/kraken</Text>
        <Text> </Text>
        <Text dimColor>
          {'  '}as-of: {asOfDate}
        </Text>
        <Text> </Text>
        <Text dimColor>q quit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text bold>Portfolio</Text> 0 <Text dimColor>assets</Text>
      </Text>
      <Text> </Text>
      <Text>{'  '}All asset balances are zero — no current holdings.</Text>
      {state.closedPositions.length > 0 && state.pnlMode === 'unrealized' && (
        <Text dimColor>{'  '}Press r to view closed positions with realized P&L.</Text>
      )}
      <Text> </Text>
      <Text dimColor>
        {'  '}as-of: {asOfDate}
      </Text>
      <Text> </Text>
      <Text dimColor>r pnl mode · q quit</Text>
    </Box>
  );
};

const PortfolioHeader: FC<{ state: PortfolioAssetsState }> = ({ state }) => {
  const visiblePositions = getVisiblePositions(state);
  const pricedNonNegative = visiblePositions.filter(
    (position) => position.priceStatus === 'ok' && !position.isNegative
  ).length;
  const netFiatInColor =
    state.totalNetFiatIn !== undefined && new Decimal(state.totalNetFiatIn).gte(0) ? 'green' : 'red';
  const showUnrealized = state.pnlMode !== 'realized';
  const showRealized = state.pnlMode !== 'unrealized';
  const realizedColor =
    state.totalRealizedGainLossAllTime !== undefined && new Decimal(state.totalRealizedGainLossAllTime).gte(0)
      ? 'green'
      : 'red';

  if (pricedNonNegative === 0) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>Portfolio</Text> {visiblePositions.length} <Text dimColor>assets</Text>
          <Text dimColor> · </Text>
          <Text dimColor>prices unavailable</Text>
          <Text dimColor>{'                              sorted by: '}</Text>
          <Text dimColor>
            {state.sortMode} {'\u25BE'}
          </Text>
          <Text dimColor>{' · pnl: '}</Text>
          <Text dimColor>{state.pnlMode}</Text>
        </Text>
        {state.totalNetFiatIn !== undefined && (
          <Text>
            {'  '}
            <Text dimColor>Net Fiat In</Text>{' '}
            <Text color={netFiatInColor}>{formatSignedCurrency(state.totalNetFiatIn, state.displayCurrency)}</Text>
          </Text>
        )}
        {showRealized && state.totalRealizedGainLossAllTime !== undefined && (
          <Text>
            {'  '}
            <Text dimColor>Realized (all-time)</Text>{' '}
            <Text color={realizedColor}>
              {formatSignedCurrency(state.totalRealizedGainLossAllTime, state.displayCurrency)}
            </Text>
          </Text>
        )}
      </Box>
    );
  }

  const totalValue = state.totalValue ? formatCurrency(state.totalValue, state.displayCurrency) : 'unavailable';
  const unrealizedColor =
    state.totalUnrealizedGainLoss !== undefined && new Decimal(state.totalUnrealizedGainLoss).gte(0) ? 'green' : 'red';

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Portfolio</Text> {visiblePositions.length} <Text dimColor>assets</Text>
        <Text dimColor> · </Text>
        {totalValue}
        <Text dimColor>{'                              sorted by: '}</Text>
        <Text dimColor>
          {state.sortMode} {'\u25BE'}
        </Text>
        <Text dimColor>{' · pnl: '}</Text>
        <Text dimColor>{state.pnlMode}</Text>
      </Text>
      {state.totalNetFiatIn !== undefined && (
        <Text>
          {'  '}
          <Text dimColor>Net Fiat In</Text>{' '}
          <Text color={netFiatInColor}>{formatSignedCurrency(state.totalNetFiatIn, state.displayCurrency)}</Text>
        </Text>
      )}
      {state.totalCost !== undefined ? (
        <Text>
          {'  '}
          <Text dimColor>Total Cost</Text> {formatCurrency(state.totalCost, state.displayCurrency)}
          {showUnrealized && (
            <>
              <Text dimColor> · Unrealized</Text>{' '}
              {state.totalUnrealizedGainLoss !== undefined ? (
                <>
                  <Text color={unrealizedColor}>
                    {formatSignedCurrency(state.totalUnrealizedGainLoss, state.displayCurrency)}
                  </Text>
                  {state.totalUnrealizedPct !== undefined && <Text dimColor> ({state.totalUnrealizedPct}%)</Text>}
                </>
              ) : (
                <Text dimColor>unavailable</Text>
              )}
            </>
          )}
        </Text>
      ) : (
        <Text>
          {'  '}
          <Text dimColor>Total Cost unavailable{showUnrealized ? ' · Unrealized unavailable' : ''}</Text>
        </Text>
      )}
      {showRealized && (
        <>
          {state.totalRealizedGainLossAllTime !== undefined ? (
            <Text>
              {'  '}
              <Text dimColor>Realized (all-time)</Text>{' '}
              <Text color={realizedColor}>
                {formatSignedCurrency(state.totalRealizedGainLossAllTime, state.displayCurrency)}
              </Text>
            </Text>
          ) : (
            <Text>
              {'  '}
              <Text dimColor>Realized (all-time) unavailable</Text>
            </Text>
          )}
        </>
      )}
    </Box>
  );
};

type PortfolioAssetCols = Columns<
  PortfolioPositionItem,
  'symbol' | 'quantity' | 'value' | 'allocation' | 'cost' | 'unrealized' | 'realized'
>;

const PortfolioAssetsList: FC<{ state: PortfolioAssetsState; visibleRows: number }> = ({ state, visibleRows }) => {
  const visiblePositions = getVisiblePositions(state);
  const { displayCurrency } = state;
  const cols = createColumns<
    PortfolioPositionItem,
    'symbol' | 'quantity' | 'value' | 'allocation' | 'cost' | 'unrealized' | 'realized'
  >(visiblePositions, {
    symbol: { format: (p) => p.assetSymbol, minWidth: 10 },
    quantity: { format: (p) => formatCryptoQuantity(p.quantity), align: 'right', minWidth: 14 },
    value: {
      format: (p) => {
        if (p.priceStatus !== 'ok' || p.currentValue === undefined) return 'USD 0.00';
        const v = new Decimal(p.currentValue);
        return formatCurrency(p.isNegative ? v.negated().toFixed(2) : v.toFixed(2), displayCurrency);
      },
      align: 'right',
      minWidth: 'USD 0.00'.length,
    },
    allocation: {
      format: (p) => (p.allocationPct ? `${p.allocationPct}%` : '--'),
      align: 'right',
      minWidth: '--'.length,
    },
    cost: {
      format: (p) =>
        p.totalCostBasis !== undefined ? formatCurrency(p.totalCostBasis, displayCurrency) : 'unavailable',
      align: 'right',
      minWidth: 'unavailable'.length,
    },
    unrealized: {
      format: (p) =>
        p.unrealizedGainLoss !== undefined ? formatSignedCurrency(p.unrealizedGainLoss, displayCurrency) : '—',
      align: 'right',
      minWidth: '—'.length,
    },
    realized: {
      format: (p) =>
        p.realizedGainLossAllTime !== undefined
          ? formatSignedCurrency(p.realizedGainLossAllTime, displayCurrency)
          : '—',
      align: 'right',
      minWidth: '—'.length,
    },
  });
  const startIndex = state.scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, visiblePositions.length);
  const visible = visiblePositions.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < visiblePositions.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}
          {'\u25B2'} {startIndex} more above
        </Text>
      )}
      {visible.map((position, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <PortfolioAssetRow
            key={position.assetId}
            position={position}
            isSelected={actualIndex === state.selectedIndex}
            pnlMode={state.pnlMode}
            cols={cols}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}
          {'\u25BC'} {visiblePositions.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const PortfolioAssetRow: FC<{
  cols: PortfolioAssetCols;
  isSelected: boolean;
  pnlMode: PortfolioPnlMode;
  position: PortfolioPositionItem;
}> = ({ position, isSelected, pnlMode, cols }) => {
  const cursor = getSelectionCursor(isSelected);
  const { symbol, quantity, value, allocation, cost, unrealized, realized } = cols.format(position);
  const quantityColor = position.isNegative ? 'red' : 'white';

  const realizedColor =
    position.realizedGainLossAllTime === undefined
      ? 'white'
      : new Decimal(position.realizedGainLossAllTime).gt(0)
        ? 'green'
        : new Decimal(position.realizedGainLossAllTime).lt(0)
          ? 'red'
          : 'white';

  if (position.isClosedPosition === true) {
    return (
      <Text>
        {cursor} {symbol} <Text color={quantityColor}>{quantity}</Text> {'  '}
        <Text dimColor>closed position</Text>
        {'  '}
        <Text dimColor>realized</Text> <Text color={realizedColor}>{realized}</Text>
      </Text>
    );
  }

  if (position.priceStatus === 'unavailable' || position.currentValue === undefined) {
    return (
      <Text dimColor={true}>
        {cursor} {symbol} <Text color={quantityColor}>{quantity}</Text> {'  '}price unavailable
        {pnlMode !== 'unrealized' && (
          <>
            {'  '}
            <Text dimColor>realized</Text> <Text color={realizedColor}>{realized}</Text>
          </>
        )}
      </Text>
    );
  }

  const valueColor = position.isNegative ? 'red' : 'white';

  const unrealizedColor =
    position.unrealizedGainLoss === undefined
      ? 'white'
      : new Decimal(position.unrealizedGainLoss).gt(0)
        ? 'green'
        : new Decimal(position.unrealizedGainLoss).lt(0)
          ? 'red'
          : 'white';

  const renderPnlColumns = () => {
    if (pnlMode === 'realized') {
      return (
        <>
          {'  '}
          <Text dimColor>cost</Text> {cost}
          {'  '}
          <Text dimColor>realized</Text> <Text color={realizedColor}>{realized}</Text>
        </>
      );
    }

    if (pnlMode === 'both') {
      return (
        <>
          {'  '}
          <Text dimColor>cost</Text> {cost}
          {'  '}
          <Text dimColor>unrealized</Text> <Text color={unrealizedColor}>{unrealized}</Text>
          {'  '}
          <Text dimColor>realized</Text> <Text color={realizedColor}>{realized}</Text>
        </>
      );
    }

    return (
      <>
        {'  '}
        <Text dimColor>cost</Text> {cost}
        {'  '}
        <Text dimColor>unrealized</Text> <Text color={unrealizedColor}>{unrealized}</Text>
      </>
    );
  };

  return (
    <Text>
      {cursor} {symbol} <Text color={quantityColor}>{quantity}</Text> {'  '}
      <Text color={valueColor}>{value}</Text>
      {'  '}
      <Text dimColor>{allocation}</Text>
      {renderPnlColumns()}
    </Text>
  );
};

const PortfolioAssetDetail: FC<{
  hiddenOpenLots: number;
  openLotsVisibleRows: number;
  state: PortfolioAssetsState;
}> = ({ state, openLotsVisibleRows, hiddenOpenLots }) => {
  const selected = getVisiblePositions(state)[state.selectedIndex];
  if (!selected) {
    return null;
  }

  const quantity = formatCryptoQuantity(selected.quantity);
  const accountSummary =
    selected.accountBreakdown.length > 0
      ? selected.accountBreakdown
          .map((account) => `${account.sourceName} (${formatCryptoQuantity(account.quantity)})`)
          .join(', ')
      : 'none';
  const realizedValue = selected.realizedGainLossAllTime ?? '0.00';
  const realizedColor = new Decimal(realizedValue).gte(0) ? 'green' : 'red';

  if (selected.isClosedPosition === true) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>
            {'\u25B8'} {selected.assetSymbol}
          </Text>{' '}
          {quantity} {selected.assetSymbol}
          <Text dimColor> · closed position</Text>
        </Text>
        <Text> </Text>
        <Text>
          {'  '}
          <Text dimColor>Realized (all-time):</Text>{' '}
          <Text color={realizedColor}>{formatSignedCurrency(realizedValue, state.displayCurrency)}</Text>
        </Text>
        <Text dimColor>{'  '}No current holdings for this asset as-of snapshot.</Text>
        <Text> </Text>
        <Text>
          {'  '}
          <Text dimColor>Accounts:</Text> <Text color="cyan">{accountSummary}</Text>
        </Text>
        <Text dimColor>{'  '}Press enter to view history</Text>
      </Box>
    );
  }

  if (selected.priceStatus === 'unavailable' || selected.spotPricePerUnit === undefined) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>
            {'\u25B8'} {selected.assetSymbol}
          </Text>{' '}
          {quantity} {selected.assetSymbol}
        </Text>
        <Text> </Text>
        <Text>{'  '}Current price could not be fetched.</Text>
        <Text dimColor>{'  '}Run exitbook prices enrich or check provider configuration.</Text>
        <Text> </Text>
        <Text>
          {'  '}
          <Text dimColor>Accounts:</Text> <Text color="cyan">{accountSummary}</Text>
        </Text>
        <Text dimColor>{'  '}Press enter to view history</Text>
      </Box>
    );
  }

  const currentValue = selected.currentValue ? formatCurrency(selected.currentValue, state.displayCurrency) : undefined;
  const allocationSuffix = selected.allocationPct ? ` · ${selected.allocationPct}% of portfolio` : '';

  if (selected.isNegative) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>
            {'\u25B8'} {selected.assetSymbol}
          </Text>{' '}
          <Text color="red">{quantity}</Text> {selected.assetSymbol}
        </Text>
        <Text> </Text>
        <Text color="yellow">{'  '}⚠ Negative balance — likely missing inflow transactions</Text>
        <Text> </Text>
        <Text>
          {'  '}
          <Text dimColor>Accounts:</Text> <Text color="cyan">{accountSummary}</Text>
        </Text>
        <Text dimColor>{'  '}Press enter to view history</Text>
      </Box>
    );
  }

  const header = currentValue
    ? `${selected.assetSymbol}  ${quantity} ${selected.assetSymbol} · ${currentValue}${allocationSuffix}`
    : `${selected.assetSymbol}  ${quantity} ${selected.assetSymbol}`;
  const showUnrealized = state.pnlMode !== 'realized';
  const showRealized = state.pnlMode !== 'unrealized';

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>
          {'\u25B8'} {header}
        </Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Current Price:</Text> {formatCurrency(selected.spotPricePerUnit, state.displayCurrency)}
        <Text dimColor>/unit</Text>
      </Text>

      {selected.openLots.length === 0 ||
      selected.totalCostBasis === undefined ||
      selected.unrealizedGainLoss === undefined ? (
        <Text dimColor>{'  '}Cost basis unavailable</Text>
      ) : (
        <>
          <Text>
            {'  '}
            <Text dimColor>Avg Cost:</Text> {formatCurrency(selected.avgCostPerUnit ?? '0', state.displayCurrency)}
            <Text dimColor>/unit</Text>
          </Text>
          {showUnrealized && (
            <Text>
              {'  '}
              <Text dimColor>Unrealized:</Text>{' '}
              <Text color={new Decimal(selected.unrealizedGainLoss).gte(0) ? 'green' : 'red'}>
                {formatSignedCurrency(selected.unrealizedGainLoss, state.displayCurrency)}
              </Text>
              {selected.unrealizedPct !== undefined && <Text dimColor> ({selected.unrealizedPct}%)</Text>}
            </Text>
          )}
          {showRealized && (
            <Text>
              {'  '}
              <Text dimColor>Realized (all-time):</Text>{' '}
              <Text color={realizedColor}>{formatSignedCurrency(realizedValue, state.displayCurrency)}</Text>
            </Text>
          )}
          <Text> </Text>
          <Text>
            {'  '}
            <Text dimColor>Open Lots:</Text> {selected.openLots.length}{' '}
            <Text dimColor>({state.method.toUpperCase()})</Text>
          </Text>
          {selected.openLots.slice(0, openLotsVisibleRows).map((lot) => (
            <Text key={lot.lotId}>
              {'    '}
              {formatCryptoQuantity(lot.remainingQuantity)} {selected.assetSymbol} <Text dimColor>acquired</Text>{' '}
              {lot.acquisitionDate.split('T')[0]} <Text dimColor>basis</Text>{' '}
              {formatCurrency(lot.costBasisPerUnit, state.displayCurrency)}
              <Text dimColor>/unit held</Text> {lot.holdingDays}
              <Text dimColor>d</Text>
            </Text>
          ))}
          {hiddenOpenLots > 0 && (
            <Text dimColor>
              {'    '}
              {'\u25BC'} {hiddenOpenLots} more open lots
            </Text>
          )}
        </>
      )}
      {showRealized &&
        (selected.openLots.length === 0 ||
          selected.totalCostBasis === undefined ||
          selected.unrealizedGainLoss === undefined) && (
          <Text>
            {'  '}
            <Text dimColor>Realized (all-time):</Text>{' '}
            <Text color={realizedColor}>{formatSignedCurrency(realizedValue, state.displayCurrency)}</Text>
          </Text>
        )}

      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Accounts:</Text> <Text color="cyan">{accountSummary}</Text>
      </Text>
      <Text dimColor>{'  '}Press enter to view history</Text>
    </Box>
  );
};

const PortfolioHistoryView: FC<{
  state: PortfolioHistoryState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  const quantity = formatCryptoQuantity(state.assetQuantity);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text dimColor>{'\u25C2'}</Text> <Text bold>{state.assetSymbol}</Text> {quantity} {state.assetSymbol}
        <Text dimColor> · </Text>
        {state.transactions.length} <Text dimColor>transactions</Text>
      </Text>
      <Text> </Text>
      {state.transactions.length === 0 ? (
        <Text>{'  '}No transactions found for this asset.</Text>
      ) : (
        <PortfolioHistoryList
          state={state}
          terminalHeight={terminalHeight}
        />
      )}
      <Divider width={terminalWidth} />
      <PortfolioTransactionDetail state={state} />
      {state.error && (
        <Text color="red">
          {'  '}
          {state.error}
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>{'↑↓/j/k · ^U/^D page · Home/End · q/esc/backspace back'}</Text>
    </Box>
  );
};

type PortfolioHistoryCols = Columns<PortfolioTransactionItem, 'category' | 'valueOrTransfer'>;

const PortfolioHistoryList: FC<{
  state: PortfolioHistoryState;
  terminalHeight: number;
}> = ({ state, terminalHeight }) => {
  const { displayCurrency } = state;
  const cols = createColumns<PortfolioTransactionItem, 'category' | 'valueOrTransfer'>(state.transactions, {
    category: { format: (t) => t.operationCategory, minWidth: 10 },
    valueOrTransfer: {
      format: (t) =>
        t.transferDirection && t.transferPeer
          ? `${t.transferDirection === 'to' ? '→' : '←'} ${t.transferPeer}`
          : t.fiatValue
            ? formatCurrency(t.fiatValue, displayCurrency)
            : '',
      minWidth: 24,
      maxWidth: 40,
    },
  });
  const visibleRows = getPortfolioHistoryVisibleRows(terminalHeight);
  const startIndex = state.scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, state.transactions.length);
  const visible = state.transactions.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < state.transactions.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}
          {'\u25B2'} {startIndex} more above
        </Text>
      )}
      {visible.map((transaction, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <PortfolioHistoryRow
            key={transaction.id}
            transaction={transaction}
            isSelected={actualIndex === state.selectedIndex}
            assetSymbol={state.assetSymbol}
            cols={cols}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}
          {'\u25BC'} {state.transactions.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const PortfolioHistoryRow: FC<{
  assetSymbol: string;
  cols: PortfolioHistoryCols;
  isSelected: boolean;
  transaction: PortfolioTransactionItem;
}> = ({ transaction, isSelected, assetSymbol, cols }) => {
  const cursor = getSelectionCursor(isSelected);
  const date = transaction.datetime.split('T')[0] ?? transaction.datetime;
  const { category, valueOrTransfer } = cols.format(transaction);
  const amountPrefix = transaction.assetDirection === 'in' ? '+' : '-';
  const amountColor = transaction.assetDirection === 'in' ? 'green' : 'red';
  const amount = `${amountPrefix}${formatCryptoQuantity(transaction.assetAmount)} ${assetSymbol}`;

  return (
    <Text>
      {cursor} <Text dimColor>{date}</Text> {category} <Text color={amountColor}>{amount}</Text>
      {'  '}
      <Text>{valueOrTransfer}</Text>
      {'  '}
      <Text color="cyan">{transaction.sourceName}</Text>
    </Text>
  );
};

const PortfolioTransactionDetail: FC<{ state: PortfolioHistoryState }> = ({ state }) => {
  const selected = state.transactions[state.selectedIndex];

  if (!selected) {
    return null;
  }

  const date = selected.datetime.split('T')[0] ?? selected.datetime;
  const amountPrefix = selected.assetDirection === 'in' ? '+' : '-';
  const amountColor = selected.assetDirection === 'in' ? 'green' : 'red';

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{'\u25B8'}</Text> <Text dimColor>{date}</Text> {selected.operationType}
        {'  '}
        <Text color={amountColor}>
          {amountPrefix}
          {formatCryptoQuantity(selected.assetAmount)} {state.assetSymbol}
        </Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Operation:</Text> {selected.operationCategory} ({selected.operationType})
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Source:</Text> <Text color="cyan">{selected.sourceName}</Text>
      </Text>
      {selected.transferDirection && selected.transferPeer && (
        <Text>
          {'  '}
          <Text dimColor>Transfer:</Text> {selected.transferDirection === 'to' ? 'to' : 'from'} {selected.transferPeer}
        </Text>
      )}
      {selected.inflows.length > 0 && (
        <Text>
          {'  '}
          <Text dimColor>Inflows:</Text> <Text color="green">{formatMovementList(selected.inflows)}</Text>
        </Text>
      )}
      {selected.outflows.length > 0 && (
        <Text>
          {'  '}
          <Text dimColor>Outflows:</Text> <Text color="red">{formatMovementList(selected.outflows)}</Text>
        </Text>
      )}
      {selected.fees.length > 0 && (
        <Text>
          {'  '}
          <Text dimColor>Fees:</Text> <Text color="yellow">{formatMovementList(selected.fees)}</Text>
        </Text>
      )}
    </Box>
  );
};

function formatMovementList(items: { amount: string; assetSymbol: string }[]): string {
  return items.map((item) => `${formatCryptoQuantity(item.amount)} ${item.assetSymbol}`).join(', ');
}

function formatSignedCurrency(amount: string, currency: string): string {
  const decimal = new Decimal(amount);
  const sign = decimal.gte(0) ? '+' : '-';
  return `${sign}${formatCurrency(decimal.abs().toFixed(2), currency)}`;
}

function formatCurrency(amount: string, currency: string): string {
  const decimal = new Decimal(amount);
  const value = decimal.toFixed(2);
  const parts = value.split('.');

  if (parts[0]) {
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  return `${currency} ${parts.join('.')}`;
}
