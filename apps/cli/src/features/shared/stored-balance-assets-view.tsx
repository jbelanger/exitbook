import type { AccountType, BalanceSnapshotVerificationStatus } from '@exitbook/core';
import { Box, Text } from 'ink';
import type { FC, ReactElement } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  createColumns,
  Divider,
  FixedHeightDetail,
  SelectableRow,
  type Columns,
} from '../../ui/shared/index.js';

import { formatStoredBalanceTimestamp, getStoredBalanceVerificationDisplay } from './stored-balance-formatters.js';
import type { StoredBalanceAssetViewItem } from './stored-balance-view.js';

const STORED_BALANCE_ASSET_DETAIL_LINES = 9;
const STORED_BALANCE_ASSETS_CHROME_LINES = calculateChromeLines({
  beforeHeader: 1,
  header: 1,
  afterHeader: 1,
  listScrollIndicators: 2,
  divider: 1,
  detail: STORED_BALANCE_ASSET_DETAIL_LINES,
  beforeControls: 1,
  controls: 1,
  buffer: 1,
});

export interface StoredBalanceAssetsExplorerState {
  accountId: number;
  accountType: AccountType;
  assets: StoredBalanceAssetViewItem[];
  lastRefreshAt?: string | undefined;
  platformKey: string;
  scrollOffset: number;
  selectedIndex: number;
  statusReason?: string | undefined;
  suggestion?: string | undefined;
  verificationStatus?: BalanceSnapshotVerificationStatus | undefined;
}

export function getStoredBalanceAssetsVisibleRows(terminalHeight: number): number {
  return calculateVisibleRows(terminalHeight, STORED_BALANCE_ASSETS_CHROME_LINES);
}

export const StoredBalanceAssetsView: FC<{
  isDrilledDown: boolean;
  state: StoredBalanceAssetsExplorerState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ isDrilledDown, state, terminalHeight, terminalWidth }) => {
  if (state.assets.length === 0) {
    return (
      <StoredBalanceAssetEmptyState
        isDrilledDown={isDrilledDown}
        state={state}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <StoredBalanceAssetHeader state={state} />
      <Text> </Text>
      <StoredBalanceAssetList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <StoredBalanceAssetDiagnosticsPanel state={state} />
      <Text> </Text>
      <StoredBalanceAssetControlsBar isDrilledDown={isDrilledDown} />
    </Box>
  );
};

const StoredBalanceAssetEmptyState: FC<{
  isDrilledDown: boolean;
  state: StoredBalanceAssetsExplorerState;
}> = ({ isDrilledDown, state }) => {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <StoredBalanceAssetHeader state={state} />
      <Text> </Text>
      <Text>{'  '}No stored balance assets found for this scope.</Text>
      <Text> </Text>
      <Text>{'  '}Run "exitbook accounts refresh" if you expected balances for this scope.</Text>
      <Text> </Text>
      <Text dimColor>{isDrilledDown ? 'q/esc/backspace back' : 'q/esc quit'}</Text>
    </Box>
  );
};

const StoredBalanceAssetHeader: FC<{ state: StoredBalanceAssetsExplorerState }> = ({ state }) => {
  const verification = getStoredBalanceVerificationDisplay(state.verificationStatus);

  return (
    <Box>
      <Text bold>Balance (stored snapshot)</Text>
      <Text>
        {'  '}
        <Text color="cyan">{state.platformKey}</Text> #{state.accountId}
      </Text>
      <Text dimColor>
        {'  '}
        {state.accountType}
      </Text>
      <Text>
        {'  '}
        {state.assets.length} <Text dimColor>assets</Text>
      </Text>
      {verification && (
        <>
          <Text dimColor> · </Text>
          <Text color={verification.color}>{verification.label}</Text>
        </>
      )}
    </Box>
  );
};

const StoredBalanceAssetList: FC<{
  state: StoredBalanceAssetsExplorerState;
  terminalHeight: number;
}> = ({ state, terminalHeight }) => {
  const visibleRows = getStoredBalanceAssetsVisibleRows(terminalHeight);
  const showComparisonStatus = state.assets.some((asset) => asset.comparisonStatus !== undefined);
  const showLiveBalances = state.assets.some((asset) => asset.liveBalance !== undefined);
  const assetColumns: StoredBalanceAssetColumns = createColumns(state.assets, {
    symbol: {
      format: (item) => item.assetSymbol,
      minWidth: 8,
    },
    calc: {
      align: 'right',
      format: (item) => item.calculatedBalance,
      minWidth: 12,
    },
    live: {
      align: 'right',
      format: (item) => item.liveBalance ?? '—',
      minWidth: 12,
    },
    status: {
      format: (item) => item.comparisonStatus ?? '—',
      minWidth: 10,
    },
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
          {'  '}▲ {startIndex} more above
        </Text>
      )}
      {visible.map((asset, windowIndex) => (
        <StoredBalanceAssetRow
          key={asset.assetId}
          asset={asset}
          assetColumns={assetColumns}
          isSelected={startIndex + windowIndex === state.selectedIndex}
          showComparisonStatus={showComparisonStatus}
          showLiveBalances={showLiveBalances}
        />
      ))}
      {Array.from({ length: Math.max(0, visibleRows - visible.length) }, (_, index) => (
        <Text key={`pad-${index}`}> </Text>
      ))}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {state.assets.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

type StoredBalanceAssetColumns = Columns<StoredBalanceAssetViewItem, 'calc' | 'live' | 'status' | 'symbol'>;

const StoredBalanceAssetRow: FC<{
  asset: StoredBalanceAssetViewItem;
  assetColumns: StoredBalanceAssetColumns;
  isSelected: boolean;
  showComparisonStatus: boolean;
  showLiveBalances: boolean;
}> = ({ asset, assetColumns, isSelected, showComparisonStatus, showLiveBalances }) => {
  const { calc, live, status, symbol } = assetColumns.format(asset);
  const balanceColor = asset.isNegative ? 'red' : 'green';

  return (
    <SelectableRow isSelected={isSelected}>
      {symbol}
      {'  '}
      <Text dimColor>calc</Text> <Text color={balanceColor}>{calc}</Text>
      {showLiveBalances && (
        <>
          {'    '}
          <Text dimColor>live</Text>{' '}
          {asset.liveBalance !== undefined ? <Text color={balanceColor}>{live}</Text> : <Text dimColor>{live}</Text>}
        </>
      )}
      {showComparisonStatus && (
        <>
          {'    '}
          <StoredBalanceAssetStatusLabel status={asset.comparisonStatus}>{status}</StoredBalanceAssetStatusLabel>
        </>
      )}
    </SelectableRow>
  );
};

const StoredBalanceAssetStatusLabel: FC<{
  children: string;
  status?: StoredBalanceAssetViewItem['comparisonStatus'] | undefined;
}> = ({ children, status }) => {
  switch (status) {
    case 'match':
      return <Text color="green">{children}</Text>;
    case 'warning':
      return <Text color="yellow">{children}</Text>;
    case 'mismatch':
      return <Text color="red">{children}</Text>;
    case 'unavailable':
      return <Text color="yellow">{children}</Text>;
    case undefined:
      return <Text dimColor>{children}</Text>;
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
};

const StoredBalanceAssetDiagnosticsPanel: FC<{ state: StoredBalanceAssetsExplorerState }> = ({ state }) => {
  const selected = state.assets[state.selectedIndex];
  if (!selected) {
    return null;
  }

  return (
    <FixedHeightDetail
      height={STORED_BALANCE_ASSET_DETAIL_LINES}
      rows={[...buildStoredBalanceDiagnosticsRows(selected), ...buildStoredBalanceMetadataRows(state, 'asset-detail')]}
    />
  );
};

function buildStoredBalanceDiagnosticsRows(asset: StoredBalanceAssetViewItem): ReactElement[] {
  const balanceColor = asset.isNegative ? 'red' : 'green';
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {asset.assetSymbol}</Text>
      {'  '}
      <Text dimColor>calculated</Text> <Text color={balanceColor}>{asset.calculatedBalance}</Text>
      {asset.liveBalance !== undefined && (
        <>
          <Text dimColor> · last verified live</Text> <Text color={balanceColor}>{asset.liveBalance}</Text>
        </>
      )}
      {asset.comparisonStatus !== undefined && (
        <>
          <Text dimColor> · status</Text>{' '}
          <StoredBalanceAssetStatusLabel status={asset.comparisonStatus}>
            {asset.comparisonStatus}
          </StoredBalanceAssetStatusLabel>
        </>
      )}
    </Text>,
    <Text key="blank"> </Text>,
    ...buildStoredBalanceDiagnosticsContentRows(asset.diagnostics),
  ];

  if (asset.isNegative) {
    rows.push(
      <Text key="negative-blank"> </Text>,
      <Text
        key="negative"
        color="yellow"
      >
        {'  '}⚠ Negative balance — likely missing inflow transactions
      </Text>
    );
  }

  return rows;
}

function buildStoredBalanceMetadataRows(
  item: {
    lastRefreshAt?: string | undefined;
    statusReason?: string | undefined;
    suggestion?: string | undefined;
  },
  keyPrefix: string
): ReactElement[] {
  return [
    ...(item.statusReason
      ? [
          <Text
            key={`${keyPrefix}-status-reason`}
            color="yellow"
          >
            {'  '}! {item.statusReason}
          </Text>,
        ]
      : []),
    ...(item.suggestion
      ? [
          <Text
            key={`${keyPrefix}-suggestion`}
            dimColor
          >
            {'  '}Suggestion: {item.suggestion}
          </Text>,
        ]
      : []),
    ...(item.lastRefreshAt
      ? [
          <Text
            key={`${keyPrefix}-last-refresh`}
            dimColor
          >
            {'  '}Last refresh: {formatStoredBalanceTimestamp(item.lastRefreshAt)}
          </Text>,
        ]
      : []),
  ];
}

function buildStoredBalanceDiagnosticsContentRows(
  diagnostics: StoredBalanceAssetViewItem['diagnostics']
): ReactElement[] {
  if (diagnostics.txCount === 0) {
    return [
      <Text
        key="empty-1"
        dimColor
      >
        {'  '}No movements found in imported transactions.
      </Text>,
      <Text
        key="empty-2"
        dimColor
      >
        {'  '}Last verified live balance may come from missing import history or an airdrop.
      </Text>,
    ];
  }

  const dateRangeText = diagnostics.dateRange
    ? `${diagnostics.dateRange.earliest.substring(0, 10)} to ${diagnostics.dateRange.latest.substring(0, 10)}`
    : '';

  return [
    <Text key="transactions">
      {'  '}
      <Text dimColor>Transactions: </Text>
      {diagnostics.txCount}
      {dateRangeText && <Text dimColor> · {dateRangeText}</Text>}
    </Text>,
    <Text key="net">
      {'  '}
      <Text dimColor>Net from transactions: </Text>
      {diagnostics.totals.net}
      <Text dimColor> (in </Text>
      <Text color="green">{diagnostics.totals.inflows}</Text>
      <Text dimColor> · out </Text>
      <Text color="yellow">{diagnostics.totals.outflows}</Text>
      <Text dimColor> · fees </Text>
      <Text color="yellow">{diagnostics.totals.fees}</Text>
      <Text dimColor>)</Text>
    </Text>,
  ];
}

const StoredBalanceAssetControlsBar: FC<{ isDrilledDown: boolean }> = ({ isDrilledDown }) => {
  if (isDrilledDown) {
    return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back</Text>;
  }

  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · q/esc quit</Text>;
};
