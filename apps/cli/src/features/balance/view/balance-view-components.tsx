/**
 * Balance view TUI components — all Ink components for the balance command.
 */

import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { useLayoutEffect, useReducer, type FC, type ReactElement, type ReactNode } from 'react';

import type { EventRelay } from '../../../ui/shared/event-relay.js';
import {
  calculateChromeLines,
  calculateVisibleRows,
  type Columns,
  createColumns,
  Divider,
  FixedHeightDetail,
  SelectableRow,
} from '../../../ui/shared/index.js';

import { balanceViewReducer, handleBalanceKeyboardInput } from './balance-view-controller.js';
import type {
  AccountOfflineItem,
  AccountVerificationItem,
  AssetComparisonItem,
  AssetDiagnostics,
  AssetOfflineItem,
  BalanceAssetState,
  BalanceEvent,
  BalanceOfflineState,
  BalanceState,
  BalanceVerificationState,
} from './balance-view-state.js';

const BALANCE_ACCOUNT_DETAIL_LINES = 7;
const BALANCE_ASSET_DETAIL_LINES = 7;

const BALANCE_ACCOUNTS_CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Balance Verification · N accounts"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: BALANCE_ACCOUNT_DETAIL_LINES, // account detail panel (asset balances)
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

const BALANCE_ASSETS_CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Balance Verification · N assets"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: BALANCE_ASSET_DETAIL_LINES, // asset detail panel (account breakdown)
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

export function getBalanceAccountsVisibleRows(terminalHeight: number): number {
  return calculateVisibleRows(terminalHeight, BALANCE_ACCOUNTS_CHROME_LINES);
}

export function getBalanceAssetsVisibleRows(terminalHeight: number): number {
  return calculateVisibleRows(terminalHeight, BALANCE_ASSETS_CHROME_LINES);
}

// ─── Main App ────────────────────────────────────────────────────────────────

export const BalanceApp: FC<{
  initialState: BalanceState;
  onQuit: () => void;
  relay?: EventRelay<BalanceEvent> | undefined;
}> = ({ initialState, relay, onQuit }) => {
  const [state, dispatch] = useReducer(balanceViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  // Connect EventRelay for verification events
  useLayoutEffect(() => {
    if (!relay) return;
    return relay.connect((event) => {
      dispatch(event);
    });
  }, [relay]);

  useInput((input, key) => {
    handleBalanceKeyboardInput(
      input,
      { ...key, backspace: key.backspace ?? false, return: key.return ?? false },
      state,
      dispatch,
      onQuit,
      terminalHeight
    );
  });

  if (state.view === 'accounts') {
    if (state.offline) {
      return (
        <OfflineAccountsView
          state={state}
          terminalHeight={terminalHeight}
          terminalWidth={terminalWidth}
        />
      );
    }
    return (
      <VerificationView
        state={state}
        terminalHeight={terminalHeight}
        terminalWidth={terminalWidth}
      />
    );
  }

  return (
    <AssetView
      state={state}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
    />
  );
};

// ─── Verification View (All-Accounts Online) ────────────────────────────────

const VerificationView: FC<{
  state: BalanceVerificationState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  if (state.accounts.length === 0) {
    return <VerificationEmptyState />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <VerificationHeader state={state} />
      <Text> </Text>
      <AccountList
        accounts={state.accounts}
        selectedIndex={state.selectedIndex}
        scrollOffset={state.scrollOffset}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <AccountDetailPanel state={state} />
      <Text> </Text>
      <AccountControlsBar phase={state.phase} />
    </Box>
  );
};

const VerificationEmptyState: FC = () => {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text bold>Balance Verification</Text>
      <Text> </Text>
      <Text>{'  '}No accounts found.</Text>
      <Text> </Text>
      <Text>{'  '}Import data to create accounts:</Text>
      <Text dimColor>{'  '}exitbook import --exchange kucoin --csv-dir ./exports/kraken</Text>
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

const VerificationHeader: FC<{ state: BalanceVerificationState }> = ({ state }) => {
  const { phase, summary, accounts } = state;

  if (phase === 'verifying') {
    return (
      <Box>
        <Text bold>Balance Verification</Text>
        <Text>
          {'  '}
          {accounts.length} accounts
        </Text>
      </Box>
    );
  }

  // Complete phase
  return (
    <Box>
      <Text bold>Balance Verification</Text>
      <Text>
        {'  '}
        {summary.verified} verified
      </Text>
      {summary.skipped > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text dimColor>{summary.skipped} skipped</Text>
        </>
      )}
      <Text dimColor> · </Text>
      <Text color="green">{summary.matches} match</Text>
      {summary.mismatches > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text color="red">{summary.mismatches} mismatch</Text>
        </>
      )}
    </Box>
  );
};

// ─── Account List ────────────────────────────────────────────────────────────

const AccountList: FC<{
  accounts: AccountVerificationItem[];
  scrollOffset: number;
  selectedIndex: number;
  terminalHeight: number;
}> = ({ accounts, selectedIndex, scrollOffset, terminalHeight }) => {
  const visibleRows = getBalanceAccountsVisibleRows(terminalHeight);
  const columns = createColumns(accounts, {
    id: { format: (item) => `#${item.accountId}`, align: 'right', minWidth: 4 },
    source: { format: (item) => item.sourceName, minWidth: 10 },
    type: { format: (item) => item.accountType, minWidth: 12 },
  });
  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, accounts.length);
  const visible = accounts.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < accounts.length;

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
          <AccountRow
            key={item.accountId}
            item={item}
            isSelected={actualIndex === selectedIndex}
            columns={columns}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {accounts.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const AccountRow: FC<{
  columns: Columns<AccountVerificationItem, 'id' | 'source' | 'type'>;
  isSelected: boolean;
  item: AccountVerificationItem;
}> = ({ item, isSelected, columns }) => {
  const icon = getAccountStatusIcon(item);
  const { id, source, type } = columns.format(item);

  // Status-dependent content
  let statusText: string;
  if (item.status === 'pending') {
    statusText = 'pending';
  } else if (item.status === 'verifying') {
    statusText = 'verifying...';
  } else if (item.status === 'skipped') {
    statusText = `skipped (${item.skipReason ?? 'unknown'})`;
  } else if (item.status === 'error') {
    statusText = `error: ${item.errorMessage ?? 'unknown'}`;
  } else {
    // success, warning, failed — show asset counts
    const assets = `${item.assetCount} ${item.assetCount === 1 ? 'asset' : 'assets'}`;
    const parts = [assets];
    if (item.matchCount > 0) parts.push(`${item.matchCount} match`);
    if (item.mismatchCount > 0) parts.push(`${item.mismatchCount} mismatch`);
    statusText = parts.join('   ');
  }

  // Dim for skipped, pending
  if (item.status === 'skipped' || item.status === 'pending') {
    return (
      <SelectableRow
        dimWhenUnselected
        isSelected={isSelected}
      >
        {icon} {id} {source} {type} {statusText}
      </SelectableRow>
    );
  }

  // Error: dim text, red icon
  if (item.status === 'error') {
    return (
      <SelectableRow isSelected={isSelected}>
        {icon}{' '}
        <Text dimColor={!isSelected}>
          {id} {source} {type} {statusText}
        </Text>
      </SelectableRow>
    );
  }

  return (
    <SelectableRow isSelected={isSelected}>
      {icon} {id} <Text color="cyan">{source}</Text> <Text dimColor>{type}</Text> <AssetCountsInline item={item} />
    </SelectableRow>
  );
};

const AssetCountsInline: FC<{ item: AccountVerificationItem }> = ({ item }) => {
  if (item.status === 'verifying') {
    return <Text color="yellow">verifying...</Text>;
  }

  return (
    <Text>
      {item.assetCount} <Text dimColor>{item.assetCount === 1 ? 'asset' : 'assets'}</Text>
      {'   '}
      {item.matchCount > 0 && (
        <>
          <Text color="green">{item.matchCount}</Text> <Text dimColor>match</Text>
        </>
      )}
      {item.mismatchCount > 0 && (
        <>
          {'  '}
          <Text color="red">{item.mismatchCount}</Text> <Text color="red">mismatch</Text>
        </>
      )}
    </Text>
  );
};

// ─── Account Detail Panel ────────────────────────────────────────────────────

const AccountDetailPanel: FC<{ state: BalanceVerificationState }> = ({ state }) => {
  const selected = state.accounts[state.selectedIndex];
  if (!selected) return null;

  return (
    <FixedHeightDetail
      height={BALANCE_ACCOUNT_DETAIL_LINES}
      rows={buildBalanceAccountDetailRows(state, selected)}
    />
  );
};

function buildBalanceAccountDetailRows(
  state: BalanceVerificationState,
  selected: AccountVerificationItem
): ReactElement[] {
  if (state.aborting) {
    return [
      <Text
        key="aborting"
        color="yellow"
      >
        ⏹ Aborting verification...
      </Text>,
    ];
  }

  if (state.phase === 'verifying') {
    const verifying = state.accounts.find((account) => account.status === 'verifying');
    if (verifying) {
      return [
        <Text
          key="verifying"
          color="yellow"
        >
          ⏳ Verifying {verifying.sourceName} (account #{verifying.accountId})...
        </Text>,
      ];
    }
  }

  if (selected.status === 'skipped') {
    return [
      <Text key="title">
        <Text bold>▸ #{selected.accountId}</Text>
        {'  '}
        <Text color="cyan">{selected.sourceName}</Text>
        {'  '}
        <Text dimColor>{selected.accountType}</Text>
        {'  '}
        <Text dimColor>skipped</Text>
      </Text>,
      <Text key="blank"> </Text>,
      <Text
        key="reason"
        dimColor
      >
        {'  '}
        {selected.skipReason ?? 'unknown reason'}
      </Text>,
    ];
  }

  if (selected.status === 'error') {
    return [
      <Text key="title">
        <Text bold>▸ #{selected.accountId}</Text>
        {'  '}
        <Text color="cyan">{selected.sourceName}</Text>
        {'  '}
        <Text dimColor>{selected.accountType}</Text>
        {'  '}
        <Text color="red">error</Text>
      </Text>,
      <Text key="blank"> </Text>,
      <Text
        key="reason"
        dimColor
      >
        {'  '}
        {selected.errorMessage ?? 'unknown error'}
      </Text>,
    ];
  }

  if (selected.status === 'pending' || selected.status === 'verifying') {
    return [
      <Text key="title">
        <Text bold>▸ #{selected.accountId}</Text>
        {'  '}
        <Text color="cyan">{selected.sourceName}</Text>
        {'  '}
        <Text dimColor>{selected.accountType}</Text>
      </Text>,
      <Text key="blank"> </Text>,
      <Text
        key="status"
        dimColor
      >
        {'  '}
        {selected.status === 'verifying' ? 'Verifying...' : 'Pending'}
      </Text>,
    ];
  }

  const comparisons = selected.comparisons ?? [];
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ #{selected.accountId}</Text>
      {'  '}
      <Text color="cyan">{selected.sourceName}</Text>
      {'  '}
      <Text dimColor>{selected.accountType}</Text>
      {'  '}
      {selected.assetCount} <Text dimColor>assets</Text>
      {selected.mismatchCount > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text color="red">{selected.mismatchCount}</Text> <Text dimColor>mismatch</Text>
        </>
      )}
    </Text>,
    <Text key="blank"> </Text>,
    ...comparisons.slice(0, 8).map((comparison) => (
      <ComparisonPreviewRow
        key={comparison.assetId}
        comparison={comparison}
      />
    )),
  ];

  if (comparisons.length > 8) {
    rows.push(
      <Text
        key="more"
        dimColor
      >
        {'  '}...and {comparisons.length - 8} more
      </Text>
    );
  }

  rows.push(
    <Text key="blank-2"> </Text>,
    <Text
      key="tip"
      dimColor
    >
      {'  '}Press enter to drill down
    </Text>
  );
  return rows;
}

const ComparisonPreviewRow: FC<{ comparison: AssetComparisonItem }> = ({ comparison }) => {
  const icon = getAssetStatusIcon(comparison.status);
  const symbol = comparison.assetSymbol.padEnd(8).substring(0, 8);
  const calc = comparison.calculatedBalance.padStart(12);
  const live = comparison.liveBalance.padStart(12);

  let statusText: string;
  if (comparison.status === 'match') {
    statusText = 'match';
  } else {
    statusText = `diff ${comparison.difference} (${comparison.percentageDiff.toFixed(1)}%)`;
  }

  return (
    <Text>
      {'  '}
      {icon}
      {'  '}
      {symbol}
      {'  '}
      <Text dimColor>calc</Text> <Text color="green">{calc}</Text>
      {'    '}
      <Text dimColor>live</Text> {live}
      {'    '}
      {comparison.status === 'match' ? (
        <Text color="green">{statusText}</Text>
      ) : (
        <Text color={comparison.status === 'mismatch' ? 'red' : 'yellow'}>{statusText}</Text>
      )}
    </Text>
  );
};

// ─── Offline Accounts View ───────────────────────────────────────────────────

const OfflineAccountsView: FC<{
  state: BalanceOfflineState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  if (state.accounts.length === 0) {
    return <OfflineEmptyState />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <OfflineHeader state={state} />
      <Text> </Text>
      <OfflineAccountList
        accounts={state.accounts}
        selectedIndex={state.selectedIndex}
        scrollOffset={state.scrollOffset}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <OfflineAccountDetailPanel state={state} />
      <Text> </Text>
      <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · enter drill down · q/esc quit</Text>
    </Box>
  );
};

const OfflineEmptyState: FC = () => {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text bold>Balances</Text> <Text dimColor>(stored snapshots)</Text>
      </Text>
      <Text> </Text>
      <Text>{'  '}No accounts found.</Text>
      <Text> </Text>
      <Text>{'  '}Import data to create accounts:</Text>
      <Text dimColor>{'  '}exitbook import --exchange kucoin --csv-dir ./exports/kraken</Text>
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

const OfflineHeader: FC<{ state: BalanceOfflineState }> = ({ state }) => {
  const filterLabel = state.sourceFilter ? ` · ${state.sourceFilter}` : '';
  return (
    <Box>
      <Text bold>Balances</Text>
      <Text dimColor> (stored snapshots{filterLabel})</Text>
      <Text>
        {'  '}
        {state.totalAccounts} accounts
      </Text>
    </Box>
  );
};

const OfflineAccountList: FC<{
  accounts: AccountOfflineItem[];
  scrollOffset: number;
  selectedIndex: number;
  terminalHeight: number;
}> = ({ accounts, selectedIndex, scrollOffset, terminalHeight }) => {
  const visibleRows = getBalanceAccountsVisibleRows(terminalHeight);
  const columns = createColumns(accounts, {
    id: { format: (item) => `#${item.accountId}`, align: 'right', minWidth: 4 },
    source: { format: (item) => item.sourceName, minWidth: 10 },
    type: { format: (item) => item.accountType, minWidth: 12 },
  });
  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, accounts.length);
  const visible = accounts.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < accounts.length;

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
          <OfflineAccountRow
            key={item.accountId}
            item={item}
            isSelected={actualIndex === selectedIndex}
            columns={columns}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {accounts.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const OfflineAccountRow: FC<{
  columns: Columns<AccountOfflineItem, 'id' | 'source' | 'type'>;
  isSelected: boolean;
  item: AccountOfflineItem;
}> = ({ item, isSelected, columns }) => {
  const { id, source, type } = columns.format(item);
  const assets = `${item.assetCount} ${item.assetCount === 1 ? 'asset' : 'assets'}`;

  return (
    <SelectableRow isSelected={isSelected}>
      {id} <Text color="cyan">{source}</Text> <Text dimColor>{type}</Text> <Text dimColor>{assets}</Text>
    </SelectableRow>
  );
};

const OfflineAccountDetailPanel: FC<{ state: BalanceOfflineState }> = ({ state }) => {
  const selected = state.accounts[state.selectedIndex];
  if (!selected) return null;

  return (
    <FixedHeightDetail
      height={BALANCE_ACCOUNT_DETAIL_LINES}
      rows={buildOfflineAccountDetailRows(selected)}
    />
  );
};

function buildOfflineAccountDetailRows(selected: AccountOfflineItem): ReactElement[] {
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ #{selected.accountId}</Text>
      {'  '}
      <Text color="cyan">{selected.sourceName}</Text>
      {'  '}
      <Text dimColor>{selected.accountType}</Text>
      {'  '}
      {selected.assetCount} <Text dimColor>assets</Text>
    </Text>,
    <Text key="blank"> </Text>,
    ...selected.assets.slice(0, 8).map((asset) => (
      <OfflineAssetPreviewRow
        key={asset.assetId}
        asset={asset}
      />
    )),
  ];

  if (selected.assets.length > 8) {
    rows.push(
      <Text
        key="more"
        dimColor
      >
        {'  '}...and {selected.assets.length - 8} more
      </Text>
    );
  }

  rows.push(
    <Text key="blank-2"> </Text>,
    <Text
      key="tip"
      dimColor
    >
      {'  '}Press enter to drill down
    </Text>
  );
  return rows;
}

const OfflineAssetPreviewRow: FC<{ asset: AssetOfflineItem }> = ({ asset }) => {
  const symbol = asset.assetSymbol.padEnd(8).substring(0, 8);
  const balance = asset.calculatedBalance.padStart(12);
  const balanceColor = asset.isNegative ? 'red' : 'green';

  return (
    <Text>
      {'  '}
      {symbol} <Text color={balanceColor}>{balance}</Text>
    </Text>
  );
};

// ─── Asset View (Single-Account / Drill-Down) ───────────────────────────────

const AssetView: FC<{
  state: BalanceAssetState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  const isDrilledDown = state.parentState !== undefined;

  if (state.assets.length === 0) {
    return <AssetEmptyState state={state} />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <AssetHeader state={state} />
      <Text> </Text>
      <AssetList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <AssetDiagnosticsPanel state={state} />
      <Text> </Text>
      <AssetControlsBar isDrilledDown={isDrilledDown} />
    </Box>
  );
};

const AssetEmptyState: FC<{ state: BalanceAssetState }> = ({ state }) => {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <AssetHeader state={state} />
      <Text> </Text>
      <Text>{'  '}No transactions found for this account.</Text>
      <Text> </Text>
      <Text>{'  '}Import transactions first:</Text>
      <Text dimColor>
        {'  '}exitbook import --blockchain {state.sourceName} --address ...
      </Text>
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

const AssetHeader: FC<{ state: BalanceAssetState }> = ({ state }) => {
  const offlineLabel = state.offline ? ' (stored snapshot)' : '';
  const { summary } = state;

  // All match shorthand
  if (!state.offline && summary.matches === summary.totalAssets && summary.totalAssets > 0) {
    return (
      <Box>
        <Text bold>Balance{offlineLabel}</Text>
        <Text>
          {'  '}
          <Text color="cyan">{state.sourceName}</Text> #{state.accountId}
        </Text>
        <Text dimColor>
          {'  '}
          {state.accountType}
        </Text>
        <Text>
          {'  '}
          {summary.totalAssets} <Text dimColor>assets</Text>
        </Text>
        <Text dimColor> · </Text>
        <Text color="green">all match</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text bold>Balance{offlineLabel}</Text>
      <Text>
        {'  '}
        <Text color="cyan">{state.sourceName}</Text> #{state.accountId}
      </Text>
      <Text dimColor>
        {'  '}
        {state.accountType}
      </Text>
      <Text>
        {'  '}
        {summary.totalAssets} <Text dimColor>assets</Text>
      </Text>
      {summary.matches !== undefined && summary.matches > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text color="green">{summary.matches} match</Text>
        </>
      )}
      {summary.mismatches !== undefined && summary.mismatches > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text color="red">{summary.mismatches} mismatch</Text>
        </>
      )}
    </Box>
  );
};

const AssetList: FC<{ state: BalanceAssetState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const visibleRows = getBalanceAssetsVisibleRows(terminalHeight);
  const assetColumns: BalanceAssetCols = createColumns(state.assets as BalanceAssetBase[], {
    symbol: { format: (item) => item.assetSymbol, minWidth: 8 },
    calc: { format: (item) => item.calculatedBalance, align: 'right', minWidth: 12 },
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
      {visible.map((item, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        const isSelected = actualIndex === state.selectedIndex;
        if (state.offline) {
          return (
            <OfflineAssetRow
              key={item.assetId}
              asset={item as AssetOfflineItem}
              isSelected={isSelected}
              assetColumns={assetColumns}
            />
          );
        }
        return (
          <OnlineAssetRow
            key={item.assetId}
            asset={item as AssetComparisonItem}
            isSelected={isSelected}
            assetColumns={assetColumns}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {state.assets.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

type BalanceAssetBase = Pick<AssetComparisonItem, 'assetSymbol' | 'calculatedBalance'>;
type BalanceAssetCols = Columns<BalanceAssetBase, 'symbol' | 'calc'>;

const OnlineAssetRow: FC<{ asset: AssetComparisonItem; assetColumns: BalanceAssetCols; isSelected: boolean }> = ({
  asset,
  isSelected,
  assetColumns,
}) => {
  const icon = getAssetStatusIcon(asset.status);
  const { symbol, calc } = assetColumns.format(asset);
  const live = asset.liveBalance.padStart(assetColumns.widths.calc);

  const statusContent =
    asset.status === 'match' ? (
      <Text color="green">match</Text>
    ) : (
      <Text>
        <Text dimColor>diff </Text>
        <Text color={asset.status === 'mismatch' ? 'red' : 'yellow'}>{asset.difference}</Text>
        <Text dimColor> ({asset.percentageDiff.toFixed(1)}%)</Text>
      </Text>
    );

  return (
    <SelectableRow isSelected={isSelected}>
      {icon}
      {'  '}
      {symbol}
      {'  '}
      <Text dimColor>calc</Text> <Text color="green">{calc}</Text>
      {'    '}
      <Text dimColor>live</Text> {live}
      {'    '}
      {statusContent}
    </SelectableRow>
  );
};

const OfflineAssetRow: FC<{ asset: AssetOfflineItem; assetColumns: BalanceAssetCols; isSelected: boolean }> = ({
  asset,
  isSelected,
  assetColumns,
}) => {
  const { symbol, calc: balance } = assetColumns.format(asset);
  const balanceColor = asset.isNegative ? 'red' : 'green';

  return (
    <SelectableRow isSelected={isSelected}>
      {symbol} <Text color={balanceColor}>{balance}</Text>
    </SelectableRow>
  );
};

// ─── Asset Diagnostics Panel ─────────────────────────────────────────────────

const AssetDiagnosticsPanel: FC<{ state: BalanceAssetState }> = ({ state }) => {
  const selected = state.assets[state.selectedIndex];
  if (!selected) return null;

  return (
    <FixedHeightDetail
      height={BALANCE_ASSET_DETAIL_LINES}
      rows={
        state.offline
          ? buildOfflineDiagnosticsRows(selected as AssetOfflineItem)
          : buildOnlineDiagnosticsRows(selected as AssetComparisonItem)
      }
    />
  );
};

function buildOnlineDiagnosticsRows(asset: AssetComparisonItem): ReactElement[] {
  const { diagnostics } = asset;
  const summaryStatus =
    asset.status === 'match' ? (
      <Text color="green">match</Text>
    ) : (
      <Text>
        <Text dimColor>diff </Text>
        <Text color={asset.status === 'mismatch' ? 'red' : 'yellow'}>{asset.difference}</Text>
        <Text dimColor> ({asset.percentageDiff.toFixed(1)}%)</Text>
      </Text>
    );

  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {asset.assetSymbol}</Text>
      {'  '}
      <Text dimColor>calculated</Text> <Text color="green">{asset.calculatedBalance}</Text>
      <Text dimColor> · live</Text> {asset.liveBalance}
      <Text dimColor> · </Text>
      {summaryStatus}
    </Text>,
    <Text key="blank"> </Text>,
    ...buildDiagnosticsContentRows(diagnostics),
  ];

  if (diagnostics.unexplainedDelta) {
    rows.push(
      <Text key="unexplained-delta">
        {'  '}
        <Text dimColor>Unexplained delta: </Text>
        <Text color={asset.status === 'mismatch' ? 'red' : 'yellow'}>{diagnostics.unexplainedDelta}</Text>
      </Text>
    );
  }

  return rows;
}

function buildOfflineDiagnosticsRows(asset: AssetOfflineItem): ReactElement[] {
  const { diagnostics } = asset;
  const balanceColor = asset.isNegative ? 'red' : 'green';
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {asset.assetSymbol}</Text>
      {'  '}
      <Text dimColor>balance</Text> <Text color={balanceColor}>{asset.calculatedBalance}</Text>
    </Text>,
    <Text key="blank"> </Text>,
    ...buildDiagnosticsContentRows(diagnostics),
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

function buildDiagnosticsContentRows(diagnostics: AssetDiagnostics): ReactElement[] {
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
        {'  '}Live balance may be from missing import history or an airdrop.
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

// ─── Controls Bars ───────────────────────────────────────────────────────────

const AccountControlsBar: FC<{ phase: 'verifying' | 'complete' }> = ({ phase }) => {
  if (phase === 'verifying') {
    return <Text dimColor>↑↓/j/k navigate · q quit</Text>;
  }
  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · enter drill down · q/esc quit</Text>;
};

const AssetControlsBar: FC<{ isDrilledDown: boolean }> = ({ isDrilledDown }) => {
  if (isDrilledDown) {
    return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · backspace back · q/esc back</Text>;
  }
  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · q/esc quit</Text>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAccountStatusIcon(item: AccountVerificationItem): ReactNode {
  switch (item.status) {
    case 'success':
      return <Text color="green">✓</Text>;
    case 'warning':
      return <Text color="yellow">⚠</Text>;
    case 'failed':
      return <Text color="red">✗</Text>;
    case 'error':
      return <Text color="red">✗</Text>;
    case 'verifying':
      return (
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
      );
    case 'skipped':
      return <Text dimColor>—</Text>;
    case 'pending':
      return <Text dimColor>·</Text>;
    default:
      return <Text dimColor>·</Text>;
  }
}

function getAssetStatusIcon(status: 'match' | 'warning' | 'mismatch'): ReactNode {
  switch (status) {
    case 'match':
      return <Text color="green">✓</Text>;
    case 'warning':
      return <Text color="yellow">⚠</Text>;
    case 'mismatch':
      return <Text color="red">✗</Text>;
  }
}
