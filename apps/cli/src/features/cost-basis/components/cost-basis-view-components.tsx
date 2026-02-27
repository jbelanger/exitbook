/**
 * Cost basis view TUI components — all Ink components for the cost-basis command.
 */

import { Box, Text, useInput, useStdout } from 'ink';
import { useReducer, type FC } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  type Columns,
  createColumns,
  Divider,
  getSelectionCursor,
} from '../../../ui/shared/index.js';
import { formatUnsignedCurrency, formatSignedCurrency } from '../cost-basis-view-utils.js';

import { costBasisViewReducer, handleCostBasisKeyboardInput } from './cost-basis-view-controller.js';
import type {
  AcquisitionViewItem,
  AssetCostBasisItem,
  CostBasisAssetState,
  CostBasisState,
  CostBasisTimelineState,
  DisposalViewItem,
  TransferViewItem,
} from './cost-basis-view-state.js';

export const COST_BASIS_ASSETS_CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 2, // "Cost Basis Summary" + methodology line
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: 10, // asset detail panel (lots/disposals)
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

export const COST_BASIS_TIMELINE_CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Timeline for {asset}"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: 7, // timeline event detail
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

// ─── Main App ────────────────────────────────────────────────────────────────

export const CostBasisApp: FC<{
  initialState: CostBasisState;
  onQuit: () => void;
}> = ({ initialState, onQuit }) => {
  const [state, dispatch] = useReducer(costBasisViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  useInput((input, key) => {
    handleCostBasisKeyboardInput(
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
      <AssetSummaryView
        state={state}
        terminalHeight={terminalHeight}
        terminalWidth={terminalWidth}
      />
    );
  }

  return (
    <TimelineView
      state={state}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
    />
  );
};

// ─── Asset Summary View (Level 1) ───────────────────────────────────────────

const AssetSummaryView: FC<{
  state: CostBasisAssetState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  if (state.assets.length === 0 || state.totalDisposals === 0) {
    return <AssetEmptyState state={state} />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <CostBasisHeader state={state} />
      {state.missingPricesWarning && <WarningBar message={state.missingPricesWarning} />}
      {state.calculationErrors && state.calculationErrors.length > 0 && <ErrorBar errors={state.calculationErrors} />}
      <Text> </Text>
      <AssetList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <AssetDetailPanel state={state} />
      {state.error && (
        <Text color="red">
          {'  '}
          {state.error}
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>{'↑↓/j/k · ^U/^D page · Home/End · enter view history · q/esc quit'}</Text>
    </Box>
  );
};

const AssetEmptyState: FC<{ state: CostBasisAssetState }> = ({ state }) => {
  const methodLabel = `${state.method.toUpperCase()} · ${state.jurisdiction} · ${state.taxYear} · ${state.currency}`;
  if (state.assets.length === 0 && state.calculationErrors && state.calculationErrors.length > 0) {
    // All assets failed — show error-only state
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text bold>Cost Basis</Text> <Text dimColor>({methodLabel})</Text>
        </Text>
        <ErrorBar errors={state.calculationErrors} />
        <Text> </Text>
        <Text dimColor>q quit</Text>
      </Box>
    );
  }

  if (state.totalLots > 0) {
    // No disposals but lots were created
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text bold>Cost Basis</Text> <Text dimColor>({methodLabel})</Text> 0 <Text dimColor>disposals</Text> ·{' '}
          {state.totalLots} <Text dimColor>lots created</Text>
        </Text>
        <Text> </Text>
        <Text>{'  '}No disposals in this period — no capital gains or losses to report.</Text>
        <Text> </Text>
        <Text>
          {'  '}
          {state.totalLots} acquisition lots were created from inflows in the date range.
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
        <Text bold>Cost Basis</Text> <Text dimColor>({methodLabel})</Text> 0 <Text dimColor>disposals</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}No transactions found in the date range {state.dateRange.startDate} to {state.dateRange.endDate}.
      </Text>
      <Text> </Text>
      <Text>{'  '}Import transactions first:</Text>
      <Text dimColor>{'  '}exitbook import --exchange kucoin --csv-dir ./exports/kraken</Text>
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

// ─── Header ──────────────────────────────────────────────────────────────────

const CostBasisHeader: FC<{ state: CostBasisAssetState }> = ({ state }) => {
  const { method, jurisdiction, taxYear, currency, totalDisposals, assets, summary } = state;
  const methodLabel = `${method.toUpperCase()} · ${jurisdiction} · ${taxYear} · ${currency}`;
  const gainLossColor = parseFloat(summary.totalGainLoss) >= 0 ? 'green' : 'red';

  const isUS = jurisdiction === 'US';

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Cost Basis</Text> <Text dimColor>({methodLabel})</Text>
        {'  '}
        {totalDisposals} <Text dimColor>disposals</Text>
        <Text dimColor> · </Text>
        {assets.length} <Text dimColor>assets</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Proceeds</Text> {formatUnsignedCurrency(summary.totalProceeds, currency)}
        <Text dimColor> · Cost Basis</Text> {formatUnsignedCurrency(summary.totalCostBasis, currency)}
        <Text dimColor> · Gain/Loss</Text>{' '}
        <Text color={gainLossColor}>{formatSignedCurrency(summary.totalGainLoss, currency)}</Text>
        {!isUS && (
          <>
            <Text dimColor> · Taxable</Text>{' '}
            <Text color={gainLossColor}>{formatSignedCurrency(summary.totalTaxableGainLoss, currency)}</Text>
          </>
        )}
      </Text>
      {isUS && summary.shortTermGainLoss !== undefined && summary.longTermGainLoss !== undefined && (
        <Text>
          {'  '}
          <Text dimColor>Short-term</Text>{' '}
          <Text color={parseFloat(summary.shortTermGainLoss) >= 0 ? 'green' : 'red'}>
            {formatSignedCurrency(summary.shortTermGainLoss, currency)}
          </Text>
          <Text dimColor> · Long-term</Text>{' '}
          <Text color={parseFloat(summary.longTermGainLoss) >= 0 ? 'green' : 'red'}>
            {formatSignedCurrency(summary.longTermGainLoss, currency)}
          </Text>
        </Text>
      )}
    </Box>
  );
};

const WarningBar: FC<{ message: string }> = ({ message }) => (
  <Text color="yellow">
    {'  '}
    {'\u26A0'} {message}
  </Text>
);

const ErrorBar: FC<{ errors: { asset: string; error: string }[] }> = ({ errors }) => (
  <Box flexDirection="column">
    {errors.map((e) => (
      <Text
        key={e.asset}
        color="red"
      >
        {'  '}
        {'\u2717'} {e.asset} — {e.error}
      </Text>
    ))}
  </Box>
);

// ─── Asset List ──────────────────────────────────────────────────────────────

const AssetList: FC<{ state: CostBasisAssetState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const visibleRows = calculateVisibleRows(terminalHeight, COST_BASIS_ASSETS_CHROME_LINES);
  const cols = createColumns(state.assets, {
    asset: { format: (item) => item.asset, minWidth: 6 },
    disposalCount: { format: (item) => `${item.disposalCount}`, align: 'right', minWidth: 5 },
    proceeds: { format: (item) => item.totalProceeds, align: 'right', minWidth: 10 },
    basis: { format: (item) => item.totalCostBasis, align: 'right', minWidth: 10 },
  });
  const startIndex = state.scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, state.assets.length);
  const visible = state.assets.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < state.assets.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}
          {'\u25B2'} {startIndex} more above
        </Text>
      )}
      {visible.map((item, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <AssetRow
            key={item.asset}
            item={item}
            currency={state.currency}
            isSelected={actualIndex === state.selectedIndex}
            cols={cols}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}
          {'\u25BC'} {state.assets.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const AssetRow: FC<{
  cols: Columns<AssetCostBasisItem, 'asset' | 'disposalCount' | 'proceeds' | 'basis'>;
  currency: string;
  isSelected: boolean;
  item: AssetCostBasisItem;
}> = ({ item, currency, isSelected, cols }) => {
  const cursor = getSelectionCursor(isSelected);
  const gainLossColor = item.isGain ? 'green' : 'red';

  const { asset, disposalCount, proceeds, basis } = cols.format(item);
  const disposalLabel = item.disposalCount === 1 ? 'disposal ' : 'disposals';
  const gainLoss = formatSignedCurrency(item.totalGainLoss, currency);

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {asset} {disposalCount} {disposalLabel} proceeds: {proceeds} basis: {basis} gain/loss: {gainLoss}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} {asset} {disposalCount} <Text dimColor>{disposalLabel}</Text>
      {'  '}
      <Text dimColor>proceeds:</Text> {proceeds}
      {'  '}
      <Text dimColor>basis:</Text> {basis}
      {'  '}
      <Text dimColor>gain/loss:</Text> <Text color={gainLossColor}>{gainLoss}</Text>
    </Text>
  );
};

// ─── Asset Detail Panel ──────────────────────────────────────────────────────

const AssetDetailPanel: FC<{ state: CostBasisAssetState }> = ({ state }) => {
  const selected = state.assets[state.selectedIndex];
  if (!selected) return null;

  const gainLossColor = selected.isGain ? 'green' : 'red';
  const isUS = state.jurisdiction === 'US';

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>
          {'\u25B8'} {selected.asset}
        </Text>
        {'  '}
        {selected.disposalCount} <Text dimColor>disposals</Text>
        <Text dimColor> · gain/loss</Text>{' '}
        <Text color={gainLossColor}>{formatSignedCurrency(selected.totalGainLoss, state.currency)}</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Proceeds: </Text> {formatUnsignedCurrency(selected.totalProceeds, state.currency)}
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Cost Basis:</Text> {formatUnsignedCurrency(selected.totalCostBasis, state.currency)}
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Gain/Loss: </Text>{' '}
        <Text color={gainLossColor}>{formatSignedCurrency(selected.totalGainLoss, state.currency)}</Text>
      </Text>
      {!isUS && (
        <Text>
          {'  '}
          <Text dimColor>Taxable: </Text>{' '}
          <Text color={gainLossColor}>{formatSignedCurrency(selected.totalTaxableGainLoss, state.currency)}</Text>
          <Text dimColor> ({getTaxRule(state.jurisdiction)})</Text>
        </Text>
      )}
      {isUS && selected.shortTermGainLoss !== undefined && selected.longTermGainLoss !== undefined && (
        <>
          <Text> </Text>
          <Text>
            {'  '}
            <Text dimColor>Short-term:</Text>{' '}
            <Text color={parseFloat(selected.shortTermGainLoss) >= 0 ? 'green' : 'red'}>
              {formatSignedCurrency(selected.shortTermGainLoss, state.currency)}
            </Text>
            <Text dimColor>
              {' '}
              ({selected.shortTermCount} {selected.shortTermCount === 1 ? 'disposal' : 'disposals'})
            </Text>
          </Text>
          <Text>
            {'  '}
            <Text dimColor>Long-term: </Text>{' '}
            <Text color={parseFloat(selected.longTermGainLoss) >= 0 ? 'green' : 'red'}>
              {formatSignedCurrency(selected.longTermGainLoss, state.currency)}
            </Text>
            <Text dimColor>
              {' '}
              ({selected.longTermCount} {selected.longTermCount === 1 ? 'disposal' : 'disposals'})
            </Text>
          </Text>
        </>
      )}
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Holding:</Text> <Text dimColor>avg</Text> {selected.avgHoldingDays} <Text dimColor>days</Text>
        <Text dimColor> · shortest</Text> {selected.shortestHoldingDays}
        <Text dimColor>d</Text>
        <Text dimColor> · longest</Text> {selected.longestHoldingDays}
        <Text dimColor>d</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Lots:</Text> {selected.lotCount} <Text dimColor>acquired</Text>
        <Text dimColor> · </Text>
        {selected.transferCount} <Text dimColor>transfers</Text>
      </Text>
      <Text> </Text>
      <Text dimColor>{'  '}Press enter to view history</Text>
    </Box>
  );
};

// ─── Timeline View (Level 2) ────────────────────────────────────────────────

const TimelineView: FC<{
  state: CostBasisTimelineState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  const _gainLossColor = parseFloat(state.assetTotalGainLoss) >= 0 ? 'green' : 'red';

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <TimelineHeader state={state} />
      <Text> </Text>
      <TimelineList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <TimelineDetailPanel state={state} />
      {state.error && (
        <Text color="red">
          {'  '}
          {state.error}
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>{'↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back'}</Text>
    </Box>
  );
};

const TimelineHeader: FC<{ state: CostBasisTimelineState }> = ({ state }) => {
  const gainLossColor = parseFloat(state.assetTotalGainLoss) >= 0 ? 'green' : 'red';

  return (
    <Text>
      <Text bold>Cost Basis</Text>
      {'  '}
      <Text bold>{state.asset}</Text>
      {'  '}
      {state.assetLotCount} <Text dimColor>lots</Text>
      <Text dimColor> · </Text>
      {state.assetDisposalCount} <Text dimColor>disposals</Text>
      <Text dimColor> · </Text>
      {state.assetTransferCount} <Text dimColor>transfers</Text>
      <Text dimColor> · gain/loss</Text>{' '}
      <Text color={gainLossColor}>{formatSignedCurrency(state.assetTotalGainLoss, state.currency)}</Text>
    </Text>
  );
};

// ─── Timeline List ───────────────────────────────────────────────────────────

type TimelineEvent = AcquisitionViewItem | DisposalViewItem | TransferViewItem;

function getTimelineQuantityLabel(event: TimelineEvent): string {
  if (event.type === 'acquisition') return `${event.quantity} ${event.asset}`;
  if (event.type === 'disposal') return `${event.quantityDisposed} ${event.asset}`;
  return `${event.quantity} ${event.asset}`;
}

const TimelineList: FC<{ state: CostBasisTimelineState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const visibleRows = calculateVisibleRows(terminalHeight, COST_BASIS_TIMELINE_CHROME_LINES);
  const cols = createColumns(state.events, {
    quantityAsset: { format: (event) => getTimelineQuantityLabel(event), minWidth: 40 },
    basisOrGainLoss: {
      format: (event) => {
        const displayCurrency = 'fxUnavailable' in event && event.fxUnavailable ? 'USD' : state.currency;
        if (event.type === 'disposal') return formatSignedCurrency(event.gainLoss, state.currency);
        return formatUnsignedCurrency(event.totalCostBasis, displayCurrency);
      },
      align: 'right',
      minWidth: 15,
    },
    holding: {
      format: (event) => (event.type === 'disposal' ? `held ${event.holdingPeriodDays}d` : ''),
      align: 'right',
      minWidth: 12,
    },
  });

  const startIndex = state.scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, state.events.length);
  const visible = state.events.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < state.events.length;
  const isUS = state.jurisdiction === 'US';

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}
          {'\u25B2'} {startIndex} more above
        </Text>
      )}
      {visible.map((event, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        const isSelected = actualIndex === state.selectedIndex;

        if (event.type === 'acquisition') {
          return (
            <AcquisitionRow
              key={event.id}
              item={event}
              currency={state.currency}
              isSelected={isSelected}
              cols={cols}
            />
          );
        }

        if (event.type === 'disposal') {
          return (
            <DisposalRow
              key={event.id}
              item={event}
              currency={state.currency}
              isUS={isUS}
              isSelected={isSelected}
              cols={cols}
            />
          );
        }

        return (
          <TransferRow
            key={event.id}
            item={event}
            currency={state.currency}
            isSelected={isSelected}
            cols={cols}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}
          {'\u25BC'} {state.events.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

// ─── Timeline Event Rows ─────────────────────────────────────────────────────

type TimelineCols = Columns<TimelineEvent, 'quantityAsset' | 'basisOrGainLoss' | 'holding'>;

const AcquisitionRow: FC<{ cols: TimelineCols; currency: string; isSelected: boolean; item: AcquisitionViewItem }> = ({
  item,
  isSelected,
  cols,
}) => {
  const cursor = getSelectionCursor(isSelected);
  const marker = '+';

  const date = item.date;
  const { quantityAsset: quantity, basisOrGainLoss: basis } = cols.format(item);
  const txId = `#${item.transactionId}`;
  const fxNote = item.fxUnavailable ? ' (FX unavailable)' : '';

  if (isSelected) {
    return (
      <Text bold>
        {cursor} <Text color="green">{marker}</Text> {date} acquired {quantity} basis {basis} {txId}
        {fxNote && <Text dimColor>{fxNote}</Text>}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} <Text color="green">{marker}</Text> <Text dimColor>{date}</Text> <Text dimColor>acquired</Text>{' '}
      <Text color="green">{quantity}</Text> <Text dimColor>basis</Text> {basis} <Text dimColor>{txId}</Text>
      {fxNote && <Text dimColor>{fxNote}</Text>}
    </Text>
  );
};

const DisposalRow: FC<{
  cols: TimelineCols;
  currency: string;
  isSelected: boolean;
  isUS: boolean;
  item: DisposalViewItem;
}> = ({ item, isUS, isSelected, cols }) => {
  const cursor = getSelectionCursor(isSelected);
  const marker = '−';
  const gainLossColor = item.isGain ? 'green' : 'red';

  const taxCategory =
    isUS && item.taxTreatmentCategory
      ? item.taxTreatmentCategory === 'long_term'
        ? 'long-term'
        : 'short-term'
      : undefined;
  const taxCategoryColor = taxCategory === 'long-term' ? 'green' : 'yellow';

  const date = item.date;
  const { quantityAsset: quantity, basisOrGainLoss: gainLoss, holding } = cols.format(item);
  const txId = `#${item.disposalTransactionId}`;

  if (isSelected) {
    return (
      <Text bold>
        {cursor} <Text color="red">{marker}</Text> {date} disposed {quantity} {gainLoss} {holding} {txId}
        {taxCategory ? `  ${taxCategory}` : ''}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} <Text color="red">{marker}</Text> <Text dimColor>{date}</Text> <Text dimColor>disposed</Text>{' '}
      <Text color="red">{quantity}</Text> <Text color={gainLossColor}>{gainLoss}</Text> <Text dimColor>{holding}</Text>{' '}
      <Text dimColor>{txId}</Text>
      {taxCategory && (
        <>
          {'  '}
          <Text color={taxCategoryColor}>{taxCategory}</Text>
        </>
      )}
    </Text>
  );
};

const TransferRow: FC<{ cols: TimelineCols; currency: string; isSelected: boolean; item: TransferViewItem }> = ({
  item,
  isSelected,
  cols,
}) => {
  const cursor = getSelectionCursor(isSelected);
  const marker = '→';

  const date = item.date;
  const { quantityAsset: quantity, basisOrGainLoss: basis } = cols.format(item);
  const txIds = `#${item.sourceTransactionId} → #${item.targetTransactionId}`;
  const fxNote = item.fxUnavailable ? ' (FX unavailable)' : '';

  if (isSelected) {
    return (
      <Text bold>
        {cursor} <Text color="cyan">{marker}</Text> {date} transfer {quantity} basis {basis} {txIds}
        {fxNote && <Text dimColor>{fxNote}</Text>}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} <Text color="cyan">{marker}</Text> <Text dimColor>{date}</Text> <Text dimColor>transfer</Text>{' '}
      <Text color="cyan">{quantity}</Text> <Text dimColor>basis</Text> {basis} <Text dimColor>{txIds}</Text>
      {fxNote && <Text dimColor>{fxNote}</Text>}
    </Text>
  );
};

// ─── Timeline Detail Panel ───────────────────────────────────────────────────

const TimelineDetailPanel: FC<{ state: CostBasisTimelineState }> = ({ state }) => {
  const selected = state.events[state.selectedIndex];
  if (!selected) return null;

  if (selected.type === 'acquisition') {
    return (
      <AcquisitionDetail
        item={selected}
        state={state}
      />
    );
  }

  if (selected.type === 'disposal') {
    return (
      <DisposalDetail
        item={selected}
        state={state}
      />
    );
  }

  return (
    <TransferDetail
      item={selected}
      state={state}
    />
  );
};

const AcquisitionDetail: FC<{ item: AcquisitionViewItem; state: CostBasisTimelineState }> = ({ item, state }) => {
  const displayCurrency = item.fxUnavailable ? 'USD' : state.currency;
  const statusLabel = formatLotStatus(item.status);

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{'\u25B8'} Acquisition</Text>
        {'  '}
        <Text dimColor>{item.date}</Text>
        {'  '}
        <Text color="green">{item.quantity}</Text> <Text bold>{item.asset}</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Cost Basis:</Text> {formatUnsignedCurrency(item.totalCostBasis, displayCurrency)}
        <Text dimColor> ({formatUnsignedCurrency(item.costBasisPerUnit, displayCurrency)}/unit)</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Status:</Text> {statusLabel}
        <Text dimColor> · remaining</Text> {item.remainingQuantity} <Text dimColor>{item.asset}</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Transaction:</Text> #{item.transactionId}
      </Text>
      {item.fxConversion && (
        <Text>
          {'  '}
          <Text dimColor>
            FX: USD {'\u2192'} {displayCurrency} at
          </Text>{' '}
          {item.fxConversion.fxRate} <Text dimColor>({item.fxConversion.fxSource})</Text>
        </Text>
      )}
      {item.fxUnavailable && (
        <Text>
          {'  '}
          <Text dimColor>FX rate unavailable for this date — amounts shown in USD</Text>
        </Text>
      )}
    </Box>
  );
};

const DisposalDetail: FC<{ item: DisposalViewItem; state: CostBasisTimelineState }> = ({ item, state }) => {
  const gainLossColor = item.isGain ? 'green' : 'red';
  const isUS = state.jurisdiction === 'US';

  const taxCategory =
    isUS && item.taxTreatmentCategory
      ? item.taxTreatmentCategory === 'long_term'
        ? 'long-term'
        : 'short-term'
      : undefined;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{'\u25B8'} Disposal</Text>
        {'  '}
        <Text dimColor>{item.date}</Text>
        {'  '}
        <Text color="red">{item.quantityDisposed}</Text> <Text bold>{item.asset}</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Proceeds: </Text> {formatUnsignedCurrency(item.totalProceeds, state.currency)}
        <Text dimColor> ({formatUnsignedCurrency(item.proceedsPerUnit, state.currency)}/unit)</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Cost Basis:</Text> {formatUnsignedCurrency(item.totalCostBasis, state.currency)}
        <Text dimColor> ({formatUnsignedCurrency(item.costBasisPerUnit, state.currency)}/unit)</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Gain/Loss: </Text>{' '}
        <Text color={gainLossColor}>{formatSignedCurrency(item.gainLoss, state.currency)}</Text>
      </Text>
      {!isUS && (
        <Text>
          {'  '}
          <Text dimColor>Taxable: </Text>{' '}
          <Text color={gainLossColor}>
            {formatSignedCurrency(computeDisposalTaxable(item.gainLoss, state.jurisdiction), state.currency)}
          </Text>
        </Text>
      )}
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Lot:</Text> <Text dimColor>acquired</Text> <Text dimColor>{item.acquisitionDate}</Text>
        <Text dimColor> · held</Text> {item.holdingPeriodDays} <Text dimColor>days</Text>
        {taxCategory && (
          <>
            <Text dimColor> · </Text>
            <Text color={taxCategory === 'long-term' ? 'green' : 'yellow'}>{taxCategory}</Text>
          </>
        )}
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Transactions:</Text> <Text dimColor>acquired</Text> #{item.acquisitionTransactionId}
        <Text dimColor> · disposed</Text> #{item.disposalTransactionId}
      </Text>
      {item.fxConversion && (
        <Text>
          {'  '}
          <Text dimColor>
            FX: USD {'\u2192'} {state.currency} at
          </Text>{' '}
          {item.fxConversion.fxRate} <Text dimColor>({item.fxConversion.fxSource})</Text>
        </Text>
      )}
    </Box>
  );
};

const TransferDetail: FC<{ item: TransferViewItem; state: CostBasisTimelineState }> = ({ item, state }) => {
  const displayCurrency = item.fxUnavailable ? 'USD' : state.currency;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{'\u25B8'} Transfer</Text>
        {'  '}
        <Text dimColor>{item.date}</Text>
        {'  '}
        <Text color="cyan">{item.quantity}</Text> <Text bold>{item.asset}</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Cost Basis:</Text> {formatUnsignedCurrency(item.totalCostBasis, displayCurrency)}
        <Text dimColor> ({formatUnsignedCurrency(item.costBasisPerUnit, displayCurrency)}/unit)</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Source Lot:</Text> <Text dimColor>acquired</Text>{' '}
        <Text dimColor>{item.sourceAcquisitionDate}</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Transactions:</Text> <Text dimColor>source</Text> #{item.sourceTransactionId}
        <Text dimColor> · target</Text> #{item.targetTransactionId}
      </Text>
      {item.feeUsdValue && (
        <Text>
          {'  '}
          <Text dimColor>Fee:</Text> USD {item.feeUsdValue}
        </Text>
      )}
      {item.fxConversion && (
        <Text>
          {'  '}
          <Text dimColor>
            FX: USD {'\u2192'} {displayCurrency} at
          </Text>{' '}
          {item.fxConversion.fxRate} <Text dimColor>({item.fxConversion.fxSource})</Text>
        </Text>
      )}
      {item.fxUnavailable && (
        <Text>
          {'  '}
          <Text dimColor>FX rate unavailable for this date — amounts shown in USD</Text>
        </Text>
      )}
    </Box>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTaxRule(jurisdiction: string): string {
  if (jurisdiction === 'CA') return '50% inclusion';
  return 'full amount';
}

function computeDisposalTaxable(gainLoss: string, jurisdiction: string): string {
  if (jurisdiction === 'CA') {
    const value = parseFloat(gainLoss);
    return (value * 0.5).toFixed(2);
  }
  return gainLoss;
}

function formatLotStatus(status: string): string {
  return status.replace(/_/g, ' ');
}
