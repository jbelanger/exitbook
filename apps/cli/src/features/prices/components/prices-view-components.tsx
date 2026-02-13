/**
 * Prices view TUI components
 */

import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useReducer, useRef, type FC } from 'react';

import { Divider } from '../../../ui/shared/index.js';
import type { AssetBreakdownEntry, MissingPriceMovement, PriceCoverageDetail } from '../prices-view-utils.js';
import { formatCoveragePercentage } from '../prices-view-utils.js';

import { handlePricesKeyboardInput, pricesViewReducer } from './prices-view-controller.js';
import { getPricesViewVisibleRows } from './prices-view-layout.js';
import type { PricesViewCoverageState, PricesViewMissingState, PricesViewState } from './prices-view-state.js';
import { missingRowKey } from './prices-view-state.js';

/**
 * Main prices view app component
 */
export const PricesViewApp: FC<{
  initialState: PricesViewState;
  onLoadMissing?: (
    asset: string
  ) => Promise<{ assetBreakdown: AssetBreakdownEntry[]; movements: MissingPriceMovement[] }>;
  onQuit: () => void;
  onSetPrice?: (asset: string, date: string, price: string) => Promise<void>;
}> = ({ initialState, onLoadMissing, onSetPrice, onQuit }) => {
  const [state, dispatch] = useReducer(pricesViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  useInput((input, key) => {
    handlePricesKeyboardInput(input, key, dispatch, onQuit, terminalHeight, state);
  });

  // Handle price submission — fires only when reducer sets submitted flag
  const submittingRef = useRef(false);
  const submitted = state.mode === 'missing' && state.activeInput?.submitted === true;
  useEffect(() => {
    if (!submitted || state.mode !== 'missing' || !state.activeInput || !onSetPrice || submittingRef.current) return;

    const price = state.activeInput.value.trim();
    const movement = state.movements[state.activeInput.rowIndex];
    if (!movement) return;

    submittingRef.current = true;
    const rowKey = missingRowKey(movement);

    void onSetPrice(movement.assetSymbol, movement.datetime, price)
      .then(() => {
        dispatch({ type: 'PRICE_SAVED', rowKey, price });
      })
      .catch((error: unknown) => {
        dispatch({ type: 'PRICE_SAVE_FAILED', error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        submittingRef.current = false;
      });
  }, [submitted, onSetPrice]);

  // Handle drill-down from coverage to missing mode
  const drillDownAsset = state.mode === 'coverage' ? state.drillDownAsset : undefined;
  const loadingRef = useRef(false);
  useEffect(() => {
    if (!drillDownAsset || !onLoadMissing || loadingRef.current) return;

    loadingRef.current = true;
    const parentState = state as PricesViewCoverageState;

    void onLoadMissing(drillDownAsset)
      .then(({ movements, assetBreakdown }) => {
        dispatch({
          type: 'DRILL_DOWN_COMPLETE',
          movements,
          assetBreakdown,
          asset: drillDownAsset,
          parentState,
        });
      })
      .catch(() => {
        dispatch({ type: 'DRILL_DOWN_FAILED', error: 'Failed to load missing prices' });
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [drillDownAsset, onLoadMissing]);

  if (state.mode === 'coverage') {
    return (
      <CoverageView
        state={state}
        terminalHeight={terminalHeight}
        terminalWidth={terminalWidth}
      />
    );
  }

  return (
    <MissingView
      state={state}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
    />
  );
};

// ─── Coverage Mode Components ───────────────────────────────────────────────

const CoverageView: FC<{
  state: PricesViewCoverageState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  if (state.coverage.length === 0) {
    return <CoverageEmptyState state={state} />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <CoverageHeader state={state} />
      <Text> </Text>
      <CoverageList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <CoverageDetailPanel state={state} />
      {state.error && <Text color="red"> {state.error}</Text>}
      <Text> </Text>
      <CoverageControlsBar state={state} />
    </Box>
  );
};

const CoverageHeader: FC<{ state: PricesViewCoverageState }> = ({ state }) => {
  const { summary, coverage, assetFilter, sourceFilter } = state;
  const filterParts: string[] = [];
  if (assetFilter) filterParts.push(assetFilter);
  if (sourceFilter) filterParts.push(sourceFilter);
  const filterSuffix = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';

  return (
    <Box>
      <Text bold>Price Coverage{filterSuffix}</Text>
      <Text> </Text>
      <Text>
        {coverage.length} asset{coverage.length !== 1 ? 's' : ''}
      </Text>
      <Text dimColor> · </Text>
      <Text color={getCoverageColor(summary.overall_coverage_percentage)}>
        {formatCoveragePercentage(summary.overall_coverage_percentage)} overall
      </Text>
      <Text dimColor> · </Text>
      <Text color="green">{summary.with_price} with price</Text>
      <Text dimColor> · </Text>
      <Text color={summary.missing_price > 0 ? 'yellow' : 'green'}>{summary.missing_price} missing</Text>
    </Box>
  );
};

const CoverageList: FC<{ state: PricesViewCoverageState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { coverage, selectedIndex, scrollOffset } = state;
  const visibleRows = getPricesViewVisibleRows(terminalHeight, 'coverage');

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, coverage.length);
  const visible = coverage.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < coverage.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}▲ {startIndex} more above
        </Text>
      )}
      {visible.map((item, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <CoverageRow
            key={item.assetSymbol}
            item={item}
            isSelected={actualIndex === selectedIndex}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {coverage.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const CoverageRow: FC<{ isSelected: boolean; item: PriceCoverageDetail }> = ({ item, isSelected }) => {
  const cursor = isSelected ? '▸' : ' ';
  const asset = item.assetSymbol.padEnd(10).substring(0, 10);
  const total = String(item.total_transactions).padStart(8);
  const withPrice = String(item.with_price).padStart(8);
  const missing = String(item.missing_price).padStart(8);
  const pct = formatCoveragePercentage(item.coverage_percentage).padStart(8);

  const icon = getCoverageIcon(item.coverage_percentage, item.missing_price);
  const iconColor = getCoverageIconColor(item.coverage_percentage, item.missing_price);

  if (isSelected) {
    return (
      <Text bold>
        {cursor} <Text color={iconColor}>{icon}</Text> {asset}
        {total}
        {withPrice}
        {missing}
        {pct}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} <Text color={iconColor}>{icon}</Text> {asset}
      {total}
      {withPrice}
      {item.missing_price > 0 ? <Text color="yellow">{missing}</Text> : <>{missing}</>}
      {pct}
    </Text>
  );
};

const CoverageDetailPanel: FC<{ state: PricesViewCoverageState }> = ({ state }) => {
  const selected = state.coverage[state.selectedIndex];
  if (!selected) return null;

  const coverageColor = getCoverageColor(selected.coverage_percentage);

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text>
        <Text bold>▸ {selected.assetSymbol}</Text>
        {'  '}
        {selected.total_transactions} transactions <Text dimColor>·</Text>{' '}
        <Text color={coverageColor}>{formatCoveragePercentage(selected.coverage_percentage)} coverage</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>With price: </Text>
        <Text color="green">{selected.with_price}</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Missing price: </Text>
        <Text color={selected.missing_price > 0 ? 'yellow' : 'green'}>{selected.missing_price}</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Sources: </Text>
        {selected.sources.map((s, i) => (
          <Text key={s.name}>
            {i > 0 && <Text dimColor> · </Text>}
            <Text color="cyan">{s.name}</Text>
            <Text> ({s.count})</Text>
          </Text>
        ))}
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Date range: </Text>
        <Text dimColor>
          {formatTimestamp(selected.dateRange.earliest)} to {formatTimestamp(selected.dateRange.latest)}
        </Text>
      </Text>
      {selected.missingSources.length > 0 && (
        <>
          <Text>
            {'  '}
            <Text dimColor>Missing in: </Text>
            {selected.missingSources.map((s, i) => (
              <Text key={s.name}>
                {i > 0 && <Text dimColor> · </Text>}
                <Text color="cyan">{s.name}</Text>
                <Text color="yellow"> ({s.count})</Text>
              </Text>
            ))}
          </Text>
          <Text> </Text>
          <Text dimColor>{'  '}Tip: Press Enter to view and set missing prices</Text>
        </>
      )}
    </Box>
  );
};

const CoverageControlsBar: FC<{ state: PricesViewCoverageState }> = ({ state }) => {
  const selected = state.coverage[state.selectedIndex];
  const canDrill = selected && selected.missing_price > 0;

  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End{canDrill ? ' · enter view missing' : ''} · q/esc quit</Text>;
};

const CoverageEmptyState: FC<{ state: PricesViewCoverageState }> = ({ state }) => {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <CoverageHeader state={state} />
      <Text> </Text>
      {state.summary.total_transactions > 0 ? (
        <Text>{'  '}All assets have complete price coverage.</Text>
      ) : (
        <Box flexDirection="column">
          <Text>No transaction data found.</Text>
          <Text> </Text>
          <Text>
            {'  '}Import transactions first: <Text dimColor>exitbook import --help</Text>
          </Text>
        </Box>
      )}
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

// ─── Missing Mode Components ────────────────────────────────────────────────

const MissingView: FC<{
  state: PricesViewMissingState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  if (state.movements.length === 0) {
    return <MissingEmptyState state={state} />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <MissingHeader state={state} />
      <Text> </Text>
      <MissingAssetBreakdown assets={state.assetBreakdown} />
      <Text> </Text>
      <MissingList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      {state.activeInput ? <PriceInputPanel state={state} /> : <MissingDetailPanel state={state} />}
      {state.error && (
        <>
          <Text> </Text>
          <Text>
            <Text color="yellow">⚠</Text> {state.error}
          </Text>
        </>
      )}
      <Text> </Text>
      <MissingControlsBar state={state} />
    </Box>
  );
};

const MissingHeader: FC<{ state: PricesViewMissingState }> = ({ state }) => {
  const { movements, resolvedRows, assetBreakdown, assetFilter, sourceFilter, parentCoverageState } = state;
  const remaining = movements.length - resolvedRows.size;
  const isDrilledIn = !!parentCoverageState;

  if (isDrilledIn && assetFilter) {
    return (
      <Box>
        <Text dimColor>← </Text>
        <Text bold>{assetFilter} Missing Prices</Text>
        <Text> </Text>
        <Text color="yellow">{remaining}</Text>
        <Text dimColor> movement{remaining !== 1 ? 's' : ''}</Text>
        {resolvedRows.size > 0 && (
          <>
            <Text dimColor> · </Text>
            <Text color="green">{resolvedRows.size} resolved</Text>
          </>
        )}
      </Box>
    );
  }

  const filterParts: string[] = [];
  if (assetFilter) filterParts.push(assetFilter);
  if (sourceFilter) filterParts.push(sourceFilter);
  const filterSuffix = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';
  const assetCount = assetBreakdown.length;

  return (
    <Box>
      <Text bold>Missing Prices{filterSuffix}</Text>
      <Text> </Text>
      <Text color="yellow">{remaining}</Text>
      <Text dimColor> movement{remaining !== 1 ? 's' : ''} across </Text>
      <Text>{assetCount}</Text>
      <Text dimColor> asset{assetCount !== 1 ? 's' : ''}</Text>
      {resolvedRows.size > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text color="green">{resolvedRows.size} resolved</Text>
        </>
      )}
    </Box>
  );
};

const MissingAssetBreakdown: FC<{ assets: AssetBreakdownEntry[] }> = ({ assets }) => {
  if (assets.length === 0) return null;

  return (
    <Box flexDirection="column">
      <Text bold>{'  '}Asset Breakdown</Text>
      {assets.map((asset) => (
        <Text key={asset.assetSymbol}>
          {'    '}
          {asset.assetSymbol.padEnd(8)}
          <Text color="yellow">
            {asset.count} movement{asset.count !== 1 ? 's' : ''}
          </Text>
          {asset.sources.map((s) => (
            <Text key={s.name}>
              <Text dimColor> · </Text>
              <Text>{s.count} from </Text>
              <Text color="cyan">{s.name}</Text>
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
};

const MissingList: FC<{ state: PricesViewMissingState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { movements, selectedIndex, scrollOffset, resolvedRows } = state;
  const visibleRows = getPricesViewVisibleRows(terminalHeight, 'missing');

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, movements.length);
  const visible = movements.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < movements.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}▲ {startIndex} more above
        </Text>
      )}
      {visible.map((movement, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <MissingRow
            key={`${movement.transactionId}-${movement.assetSymbol}-${movement.direction}`}
            movement={movement}
            isSelected={actualIndex === selectedIndex}
            isResolved={resolvedRows.has(missingRowKey(movement))}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {movements.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const MissingRow: FC<{
  isResolved: boolean;
  isSelected: boolean;
  movement: MissingPriceMovement;
}> = ({ movement, isSelected, isResolved }) => {
  const cursor = isSelected ? '▸' : ' ';
  const txId = `#${movement.transactionId}`.padStart(6);
  const source = movement.source.padEnd(10).substring(0, 10);
  const timestamp = movement.datetime.substring(0, 16).replace('T', ' ');
  const asset = movement.assetSymbol.padEnd(10).substring(0, 10);
  const dir = movement.direction === 'inflow' ? 'IN ' : 'OUT';
  const dirColor = movement.direction === 'inflow' ? 'green' : 'yellow';
  const amount = formatAmount(movement.amount, 12);

  if (isResolved) {
    return (
      <Text dimColor>
        {cursor} ✓ {txId} {source} {timestamp} {asset} {dir} {amount}
      </Text>
    );
  }

  if (isSelected) {
    return (
      <Text bold>
        {cursor} <Text color="yellow">⚠</Text> {txId} {source} <Text dimColor>{timestamp}</Text> {asset}{' '}
        <Text color={dirColor}>{dir}</Text> <Text color="green">{amount}</Text>
      </Text>
    );
  }

  return (
    <Text>
      {cursor} <Text color="yellow">⚠</Text> {txId} <Text color="cyan">{source}</Text> <Text dimColor>{timestamp}</Text>{' '}
      {asset} <Text color={dirColor}>{dir}</Text> <Text color="green">{amount}</Text>
    </Text>
  );
};

const MissingDetailPanel: FC<{ state: PricesViewMissingState }> = ({ state }) => {
  const movement = state.movements[state.selectedIndex];
  if (!movement) return null;

  const isResolved = state.resolvedRows.has(missingRowKey(movement));
  const dir = movement.direction === 'inflow' ? 'IN' : 'OUT';
  const dirColor = movement.direction === 'inflow' ? 'green' : 'yellow';
  const opParts = [movement.operationCategory, movement.operationType].filter(Boolean).join('/');

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text>
        <Text bold>▸ #{movement.transactionId}</Text>
        {'  '}
        <Text color="cyan">{movement.source}</Text>
        {'  '}
        {opParts && (
          <>
            <Text dimColor>{opParts}</Text>
            {'  '}
          </>
        )}
        <Text dimColor>{movement.datetime}</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Asset: </Text>
        {movement.assetSymbol}
        {'  '}
        <Text color={dirColor}>{dir}</Text>
        {'  '}
        <Text color="green">{movement.amount}</Text>
      </Text>
      {isResolved ? (
        <>
          <Text>
            {'  '}
            <Text dimColor>Price: </Text>
            <Text color="green">{movement.resolvedPrice}</Text>
            <Text dimColor> USD</Text> <Text color="green">✓</Text>
          </Text>
          <Text> </Text>
          <Text dimColor>{'  '}Tip: Re-run `exitbook prices enrich` to propagate this price.</Text>
        </>
      ) : (
        <>
          <Text>
            {'  '}
            <Text dimColor>Price: </Text>
            <Text color="yellow">missing</Text>
          </Text>
          <Text> </Text>
          <Text dimColor>{'  '}Tip: Press 's' to set price, or use:</Text>
          <Text dimColor>
            {'  '}exitbook prices set --asset {movement.assetSymbol} --date "{movement.datetime}" --price {'<amount>'}
          </Text>
        </>
      )}
    </Box>
  );
};

const PriceInputPanel: FC<{ state: PricesViewMissingState }> = ({ state }) => {
  if (!state.activeInput) return null;

  const movement = state.movements[state.activeInput.rowIndex];
  if (!movement) return null;

  const dir = movement.direction === 'inflow' ? 'IN' : 'OUT';
  const dirColor = movement.direction === 'inflow' ? 'green' : 'yellow';

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text bold>
        ▸ #{movement.transactionId}
        {'  '}
        {movement.source}
        {'  '}
        {movement.assetSymbol}
        {'  '}
        <Text color={dirColor}>{dir}</Text>
        {'  '}
        <Text color="green">{movement.amount}</Text>
        {'  '}
        <Text dimColor>{movement.datetime}</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}Price (USD): <Text color="green">{state.activeInput.value}</Text>
        <Text color="green">█</Text>
      </Text>
      {state.activeInput.validationError && (
        <Text>
          {'  '}
          <Text color="red">⚠ {state.activeInput.validationError}</Text>
        </Text>
      )}
    </Box>
  );
};

const MissingControlsBar: FC<{ state: PricesViewMissingState }> = ({ state }) => {
  if (state.activeInput) {
    return <Text dimColor>enter save · esc cancel</Text>;
  }

  const movement = state.movements[state.selectedIndex];
  const canSetPrice = movement && !state.resolvedRows.has(missingRowKey(movement));
  const isDrilledIn = !!state.parentCoverageState;

  const quitPart = isDrilledIn ? ' · esc back · q quit' : ' · q/esc quit';

  return (
    <Text dimColor>
      ↑↓/j/k · ^U/^D page · Home/End{canSetPrice ? ' · s set price' : ''}
      {quitPart}
    </Text>
  );
};

const MissingEmptyState: FC<{ state: PricesViewMissingState }> = ({ state }) => {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <MissingHeader state={state} />
      <Text> </Text>
      <Text>{'  '}All movements have price data.</Text>
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

// ─── Helper Functions ───────────────────────────────────────────────────────

function getCoverageColor(percentage: number): string {
  if (percentage >= 95) return 'green';
  if (percentage >= 70) return 'yellow';
  return 'red';
}

function getCoverageIcon(percentage: number, missingCount: number): string {
  if (percentage === 100) return '✓';
  if (missingCount > 0 && percentage > 0) return '⚠';
  return '✗';
}

function getCoverageIconColor(percentage: number, missingCount: number): string {
  if (percentage === 100) return 'green';
  if (missingCount > 0 && percentage > 0) return 'yellow';
  return 'red';
}

function formatTimestamp(datetime: string): string {
  return datetime.substring(0, 16).replace('T', ' ');
}

function formatAmount(amount: string, width: number): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount.padStart(width);

  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  return formatted.padStart(width);
}
