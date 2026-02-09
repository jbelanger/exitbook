/**
 * Cost basis view TUI components — all Ink components for the cost-basis command.
 */

import { Box, Text, useInput, useStdout } from 'ink';
import { useReducer, type FC } from 'react';

import { Divider } from '../../../ui/shared/index.js';

import { costBasisViewReducer, handleCostBasisKeyboardInput } from './cost-basis-view-controller.js';
import { getCostBasisAssetsVisibleRows, getCostBasisDisposalsVisibleRows } from './cost-basis-view-layout.js';
import type {
  AssetCostBasisItem,
  CostBasisAssetState,
  CostBasisDisposalState,
  CostBasisState,
  DisposalViewItem,
} from './cost-basis-view-state.js';
import { formatSignedCurrency, formatUnsignedCurrency } from './cost-basis-view-utils.js';

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
    <DisposalListView
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
  if (state.assets.length === 0) {
    return <AssetEmptyState state={state} />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <CostBasisHeader state={state} />
      {state.missingPricesWarning && <WarningBar message={state.missingPricesWarning} />}
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
      <Text dimColor>{'↑↓/j/k · ^U/^D page · Home/End · enter view disposals · q/esc quit'}</Text>
    </Box>
  );
};

const AssetEmptyState: FC<{ state: CostBasisAssetState }> = ({ state }) => {
  const methodLabel = `${state.method.toUpperCase()} · ${state.jurisdiction} · ${state.taxYear} · ${state.currency}`;

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
      <Text dimColor>{'  '}exitbook import --exchange kraken --csv-dir ./exports/kraken</Text>
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

// ─── Asset List ──────────────────────────────────────────────────────────────

const AssetList: FC<{ state: CostBasisAssetState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const visibleRows = getCostBasisAssetsVisibleRows(terminalHeight);
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

const AssetRow: FC<{ currency: string; isSelected: boolean; item: AssetCostBasisItem; }> = ({
  item,
  currency,
  isSelected,
}) => {
  const cursor = isSelected ? '\u25B8' : ' ';
  const asset = item.asset.padEnd(10).substring(0, 10);
  const disposals = `${item.disposalCount} ${item.disposalCount === 1 ? 'disposal' : 'disposals'}`;
  const gainLossColor = item.isGain ? 'green' : 'red';

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {asset} {disposals} proceeds {currency} {item.totalProceeds} basis {currency} {item.totalCostBasis}{' '}
        {formatSignedCurrency(item.totalGainLoss, currency)}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} {asset} {item.disposalCount} <Text dimColor>{item.disposalCount === 1 ? 'disposal' : 'disposals'}</Text>
      {'   '}
      <Text dimColor>proceeds</Text> <Text dimColor>{currency}</Text> {item.totalProceeds}
      {'   '}
      <Text dimColor>basis</Text> <Text dimColor>{currency}</Text> {item.totalCostBasis}
      {'   '}
      <Text color={gainLossColor}>{formatSignedCurrency(item.totalGainLoss, currency)}</Text>
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
      <Text dimColor>{'  '}Press enter to view disposals</Text>
    </Box>
  );
};

// ─── Disposal List View (Level 2) ───────────────────────────────────────────

const DisposalListView: FC<{
  state: CostBasisDisposalState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  const gainLossColor = parseFloat(state.assetTotalGainLoss) >= 0 ? 'green' : 'red';

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text bold>Cost Basis</Text>
        {'  '}
        <Text bold>{state.asset}</Text>
        {'  '}
        {state.assetDisposalCount} <Text dimColor>disposals</Text>
        <Text dimColor> · gain/loss</Text>{' '}
        <Text color={gainLossColor}>{formatSignedCurrency(state.assetTotalGainLoss, state.currency)}</Text>
      </Text>
      <Text> </Text>
      <DisposalList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <DisposalDetailPanel state={state} />
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

// ─── Disposal List ───────────────────────────────────────────────────────────

const DisposalList: FC<{ state: CostBasisDisposalState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const visibleRows = getCostBasisDisposalsVisibleRows(terminalHeight);
  const startIndex = state.scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, state.disposals.length);
  const visible = state.disposals.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < state.disposals.length;
  const isUS = state.jurisdiction === 'US';

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
          <DisposalRow
            key={item.id}
            item={item}
            currency={state.currency}
            isUS={isUS}
            isSelected={actualIndex === state.selectedIndex}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}
          {'\u25BC'} {state.disposals.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const DisposalRow: FC<{ currency: string; isSelected: boolean; isUS: boolean; item: DisposalViewItem; }> = ({
  item,
  currency,
  isUS,
  isSelected,
}) => {
  const cursor = isSelected ? '\u25B8' : ' ';
  const gainLossColor = item.isGain ? 'green' : 'red';
  const holdingDays = `${item.holdingPeriodDays}d`;

  const taxCategory =
    isUS && item.taxTreatmentCategory
      ? item.taxTreatmentCategory === 'long_term'
        ? 'long-term'
        : 'short-term'
      : undefined;
  const taxCategoryColor = taxCategory === 'long-term' ? 'green' : 'yellow';

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {item.disposalDate} {item.quantityDisposed} {item.asset}{' '}
        {formatSignedCurrency(item.gainLoss, currency)} {holdingDays}
        {taxCategory ? `  ${taxCategory}` : ''}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} <Text dimColor>{item.disposalDate}</Text> <Text color="green">{item.quantityDisposed}</Text> {item.asset}
      {'   '}
      <Text color={gainLossColor}>{formatSignedCurrency(item.gainLoss, currency)}</Text>
      {'   '}
      {item.holdingPeriodDays}
      <Text dimColor>d</Text>
      {taxCategory && (
        <>
          {'  '}
          <Text color={taxCategoryColor}>{taxCategory}</Text>
        </>
      )}
    </Text>
  );
};

// ─── Disposal Detail Panel ───────────────────────────────────────────────────

const DisposalDetailPanel: FC<{ state: CostBasisDisposalState }> = ({ state }) => {
  const selected = state.disposals[state.selectedIndex];
  if (!selected) return null;

  const gainLossColor = selected.isGain ? 'green' : 'red';
  const isUS = state.jurisdiction === 'US';

  const taxCategory =
    isUS && selected.taxTreatmentCategory
      ? selected.taxTreatmentCategory === 'long_term'
        ? 'long-term'
        : 'short-term'
      : undefined;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{'\u25B8'} Disposal</Text>
        {'  '}
        <Text dimColor>{selected.disposalDate}</Text>
        {'  '}
        <Text color="green">{selected.quantityDisposed}</Text> <Text bold>{selected.asset}</Text>
      </Text>
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Proceeds: </Text> {formatUnsignedCurrency(selected.totalProceeds, state.currency)}
        <Text dimColor> ({formatUnsignedCurrency(selected.proceedsPerUnit, state.currency)}/unit)</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Cost Basis:</Text> {formatUnsignedCurrency(selected.totalCostBasis, state.currency)}
        <Text dimColor> ({formatUnsignedCurrency(selected.costBasisPerUnit, state.currency)}/unit)</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Gain/Loss: </Text>{' '}
        <Text color={gainLossColor}>{formatSignedCurrency(selected.gainLoss, state.currency)}</Text>
      </Text>
      {!isUS && (
        <Text>
          {'  '}
          <Text dimColor>Taxable: </Text>{' '}
          <Text color={gainLossColor}>
            {formatSignedCurrency(computeDisposalTaxable(selected.gainLoss, state.jurisdiction), state.currency)}
          </Text>
        </Text>
      )}
      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Lot:</Text> <Text dimColor>acquired</Text> <Text dimColor>{selected.acquisitionDate}</Text>
        <Text dimColor> · held</Text> {selected.holdingPeriodDays} <Text dimColor>days</Text>
        {taxCategory && (
          <>
            <Text dimColor> · </Text>
            <Text color={taxCategory === 'long-term' ? 'green' : 'yellow'}>{taxCategory}</Text>
          </>
        )}
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Transactions:</Text> <Text dimColor>acquired</Text> #{selected.acquisitionTransactionId}
        <Text dimColor> · disposed</Text> #{selected.disposalTransactionId}
      </Text>
      {selected.fxConversion && (
        <Text>
          {'  '}
          <Text dimColor>
            FX: USD {'\u2192'} {state.currency} at
          </Text>{' '}
          {selected.fxConversion.fxRate} <Text dimColor>({selected.fxConversion.fxSource})</Text>
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
