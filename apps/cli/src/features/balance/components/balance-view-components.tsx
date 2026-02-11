/**
 * Balance view TUI components — all Ink components for the balance command.
 */

import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { useLayoutEffect, useReducer, type FC, type ReactNode } from 'react';

import type { EventRelay } from '../../../ui/shared/event-relay.js';
import { Divider } from '../../../ui/shared/index.js';

import { balanceViewReducer, handleBalanceKeyboardInput } from './balance-view-controller.js';
import { getBalanceAccountsVisibleRows, getBalanceAssetsVisibleRows } from './balance-view-layout.js';
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
import { formatSignedAmount, truncateAddress } from './balance-view-utils.js';

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
      <Text dimColor>{'  '}exitbook import --exchange kraken --csv-dir ./exports/kraken</Text>
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

const AccountRow: FC<{ isSelected: boolean; item: AccountVerificationItem }> = ({ item, isSelected }) => {
  const cursor = isSelected ? '▸' : ' ';
  const icon = getAccountStatusIcon(item);
  const id = `#${item.accountId}`.padStart(4);
  const source = item.sourceName.padEnd(10).substring(0, 10);
  const type = item.accountType.padEnd(12).substring(0, 12);

  // Status-dependent content
  let statusText = '';
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

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {icon} {id} {source} {type} {statusText}
      </Text>
    );
  }

  // Dim for skipped, pending
  if (item.status === 'skipped' || item.status === 'pending') {
    return (
      <Text dimColor>
        {cursor} {icon} {id} {source} {type} {statusText}
      </Text>
    );
  }

  // Error: dim text, red icon
  if (item.status === 'error') {
    return (
      <Text>
        {cursor} {icon}{' '}
        <Text dimColor>
          {id} {source} {type} {statusText}
        </Text>
      </Text>
    );
  }

  return (
    <Text>
      {cursor} {icon} {id} <Text color="cyan">{source}</Text> <Text dimColor>{type}</Text>{' '}
      <AssetCountsInline item={item} />
    </Text>
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

  // Aborting: show abort message
  if (state.aborting) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">⏹ Aborting verification...</Text>
      </Box>
    );
  }

  // During verification: show current status
  if (state.phase === 'verifying') {
    const verifying = state.accounts.find((a) => a.status === 'verifying');
    if (verifying) {
      return (
        <Box flexDirection="column">
          <Text color="yellow">
            ⏳ Verifying {verifying.sourceName} (account #{verifying.accountId})...
          </Text>
        </Box>
      );
    }
  }

  // Skipped
  if (selected.status === 'skipped') {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>▸ #{selected.accountId}</Text>
          {'  '}
          <Text color="cyan">{selected.sourceName}</Text>
          {'  '}
          <Text dimColor>{selected.accountType}</Text>
          {'  '}
          <Text dimColor>skipped</Text>
        </Text>
        <Text> </Text>
        <Text dimColor>
          {'  '}
          {selected.skipReason ?? 'unknown reason'}
        </Text>
      </Box>
    );
  }

  // Error
  if (selected.status === 'error') {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>▸ #{selected.accountId}</Text>
          {'  '}
          <Text color="cyan">{selected.sourceName}</Text>
          {'  '}
          <Text dimColor>{selected.accountType}</Text>
          {'  '}
          <Text color="red">error</Text>
        </Text>
        <Text> </Text>
        <Text dimColor>
          {'  '}
          {selected.errorMessage ?? 'unknown error'}
        </Text>
      </Box>
    );
  }

  // Pending / verifying
  if (selected.status === 'pending' || selected.status === 'verifying') {
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>▸ #{selected.accountId}</Text>
          {'  '}
          <Text color="cyan">{selected.sourceName}</Text>
          {'  '}
          <Text dimColor>{selected.accountType}</Text>
        </Text>
        <Text> </Text>
        <Text dimColor>
          {'  '}
          {selected.status === 'verifying' ? 'Verifying...' : 'Pending'}
        </Text>
      </Box>
    );
  }

  // Completed: show per-asset breakdown
  const comparisons = selected.comparisons ?? [];
  const mismatchCount = selected.mismatchCount;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>▸ #{selected.accountId}</Text>
        {'  '}
        <Text color="cyan">{selected.sourceName}</Text>
        {'  '}
        <Text dimColor>{selected.accountType}</Text>
        {'  '}
        {selected.assetCount} <Text dimColor>assets</Text>
        {mismatchCount > 0 && (
          <>
            <Text dimColor> · </Text>
            <Text color="red">{mismatchCount}</Text> <Text dimColor>mismatch</Text>
          </>
        )}
      </Text>
      <Text> </Text>
      {comparisons.slice(0, 8).map((c) => (
        <ComparisonPreviewRow
          key={c.assetId}
          comparison={c}
        />
      ))}
      {comparisons.length > 8 && (
        <Text dimColor>
          {'  '}...and {comparisons.length - 8} more
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>{'  '}Press enter to drill down</Text>
    </Box>
  );
};

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
        <Text bold>Balances</Text> <Text dimColor>(offline)</Text>
      </Text>
      <Text> </Text>
      <Text>{'  '}No accounts found.</Text>
      <Text> </Text>
      <Text>{'  '}Import data to create accounts:</Text>
      <Text dimColor>{'  '}exitbook import --exchange kraken --csv-dir ./exports/kraken</Text>
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
      <Text dimColor> (offline{filterLabel})</Text>
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

const OfflineAccountRow: FC<{ isSelected: boolean; item: AccountOfflineItem }> = ({ item, isSelected }) => {
  const cursor = isSelected ? '▸' : ' ';
  const id = `#${item.accountId}`.padStart(4);
  const source = item.sourceName.padEnd(10).substring(0, 10);
  const type = item.accountType.padEnd(12).substring(0, 12);
  const assets = `${item.assetCount} ${item.assetCount === 1 ? 'asset' : 'assets'}`;

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {id} {source} {type} {assets}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} {id} <Text color="cyan">{source}</Text> <Text dimColor>{type}</Text> <Text dimColor>{assets}</Text>
    </Text>
  );
};

const OfflineAccountDetailPanel: FC<{ state: BalanceOfflineState }> = ({ state }) => {
  const selected = state.accounts[state.selectedIndex];
  if (!selected) return null;

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>▸ #{selected.accountId}</Text>
        {'  '}
        <Text color="cyan">{selected.sourceName}</Text>
        {'  '}
        <Text dimColor>{selected.accountType}</Text>
        {'  '}
        {selected.assetCount} <Text dimColor>assets</Text>
      </Text>
      <Text> </Text>
      {selected.assets.slice(0, 8).map((asset) => (
        <OfflineAssetPreviewRow
          key={asset.assetId}
          asset={asset}
        />
      ))}
      {selected.assets.length > 8 && (
        <Text dimColor>
          {'  '}...and {selected.assets.length - 8} more
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>{'  '}Press enter to drill down</Text>
    </Box>
  );
};

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
  const offlineLabel = state.offline ? ' (offline)' : '';
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
            />
          );
        }
        return (
          <OnlineAssetRow
            key={item.assetId}
            asset={item as AssetComparisonItem}
            isSelected={isSelected}
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

const OnlineAssetRow: FC<{ asset: AssetComparisonItem; isSelected: boolean }> = ({ asset, isSelected }) => {
  const cursor = isSelected ? '▸' : ' ';
  const icon = getAssetStatusIcon(asset.status);
  const symbol = asset.assetSymbol.padEnd(8).substring(0, 8);
  const calc = asset.calculatedBalance.padStart(12);
  const live = asset.liveBalance.padStart(12);

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

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {icon} {symbol} calc {calc} live {live}{' '}
        {asset.status === 'match' ? 'match' : `diff ${asset.difference} (${asset.percentageDiff.toFixed(1)}%)`}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} {icon}
      {'  '}
      {symbol}
      {'  '}
      <Text dimColor>calc</Text> <Text color="green">{calc}</Text>
      {'    '}
      <Text dimColor>live</Text> {live}
      {'    '}
      {statusContent}
    </Text>
  );
};

const OfflineAssetRow: FC<{ asset: AssetOfflineItem; isSelected: boolean }> = ({ asset, isSelected }) => {
  const cursor = isSelected ? '▸' : ' ';
  const symbol = asset.assetSymbol.padEnd(8).substring(0, 8);
  const balance = asset.calculatedBalance.padStart(12);
  const balanceColor = asset.isNegative ? 'red' : 'green';

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {symbol} {balance}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} {symbol} <Text color={balanceColor}>{balance}</Text>
    </Text>
  );
};

// ─── Asset Diagnostics Panel ─────────────────────────────────────────────────

const AssetDiagnosticsPanel: FC<{ state: BalanceAssetState }> = ({ state }) => {
  const selected = state.assets[state.selectedIndex];
  if (!selected) return null;

  if (state.offline) {
    return <OfflineDiagnosticsPanel asset={selected as AssetOfflineItem} />;
  }

  return <OnlineDiagnosticsPanel asset={selected as AssetComparisonItem} />;
};

const OnlineDiagnosticsPanel: FC<{ asset: AssetComparisonItem }> = ({ asset }) => {
  const { diagnostics } = asset;

  // Summary line
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

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>▸ {asset.assetSymbol}</Text>
        {'  '}
        <Text dimColor>calculated</Text> <Text color="green">{asset.calculatedBalance}</Text>
        <Text dimColor> · live</Text> {asset.liveBalance}
        <Text dimColor> · </Text>
        {summaryStatus}
      </Text>
      <Text> </Text>
      <DiagnosticsContent diagnostics={diagnostics} />
      {diagnostics.impliedMissing && (
        <Text>
          {'  '}
          <Text dimColor>Implied missing: </Text>
          <Text color="red">{diagnostics.impliedMissing}</Text>
        </Text>
      )}
      <DiagnosticsSamples diagnostics={diagnostics} />
    </Box>
  );
};

const OfflineDiagnosticsPanel: FC<{ asset: AssetOfflineItem }> = ({ asset }) => {
  const { diagnostics } = asset;
  const balanceColor = asset.isNegative ? 'red' : 'green';

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>▸ {asset.assetSymbol}</Text>
        {'  '}
        <Text dimColor>balance</Text> <Text color={balanceColor}>{asset.calculatedBalance}</Text>
      </Text>
      <Text> </Text>
      <DiagnosticsContent diagnostics={diagnostics} />
      {asset.isNegative && (
        <>
          <Text> </Text>
          <Text color="yellow">{'  '}⚠ Negative balance — likely missing inflow transactions</Text>
        </>
      )}
      <DiagnosticsSamples diagnostics={diagnostics} />
    </Box>
  );
};

const DiagnosticsContent: FC<{ diagnostics: AssetDiagnostics }> = ({ diagnostics }) => {
  if (diagnostics.txCount === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>{'  '}No movements found in imported transactions.</Text>
        <Text dimColor>{'  '}Live balance may be from missing import history or an airdrop.</Text>
      </Box>
    );
  }

  const dateRangeText = diagnostics.dateRange
    ? `${diagnostics.dateRange.earliest.substring(0, 10)} to ${diagnostics.dateRange.latest.substring(0, 10)}`
    : '';

  return (
    <Box flexDirection="column">
      <Text>
        {'  '}
        <Text dimColor>Transactions: </Text>
        {diagnostics.txCount}
        {dateRangeText && <Text dimColor> · {dateRangeText}</Text>}
      </Text>
      <Text>
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
      </Text>
    </Box>
  );
};

const DiagnosticsSamples: FC<{ diagnostics: AssetDiagnostics }> = ({ diagnostics }) => {
  if (diagnostics.txCount === 0) return null;

  return (
    <Box flexDirection="column">
      {diagnostics.topOutflows.length > 0 && (
        <>
          <Text> </Text>
          <Text dimColor>{'  '}Top Outflows</Text>
          {diagnostics.topOutflows.map((sample, i) => (
            <SampleRow
              key={`out-${i}`}
              sample={sample}
              type="outflow"
            />
          ))}
        </>
      )}
      {diagnostics.topInflows.length > 0 && (
        <>
          <Text> </Text>
          <Text dimColor>{'  '}Top Inflows</Text>
          {diagnostics.topInflows.map((sample, i) => (
            <SampleRow
              key={`in-${i}`}
              sample={sample}
              type="inflow"
            />
          ))}
        </>
      )}
      {diagnostics.topFees.length > 0 && (
        <>
          <Text> </Text>
          <Text dimColor>{'  '}Top Fees</Text>
          {diagnostics.topFees.map((sample, i) => (
            <FeeSampleRow
              key={`fee-${i}`}
              sample={sample}
            />
          ))}
        </>
      )}
    </Box>
  );
};

const SampleRow: FC<{
  sample: {
    amount: string;
    datetime: string;
    from?: string | undefined;
    to?: string | undefined;
    transactionHash?: string | undefined;
  };
  type: 'inflow' | 'outflow';
}> = ({ sample, type }) => {
  const amount = formatSignedAmount(sample.amount);
  const amountColor = type === 'inflow' ? 'green' : 'yellow';
  const peerLabel = type === 'inflow' ? 'from' : 'to';
  const peer = type === 'inflow' ? sample.from : sample.to;

  return (
    <Text>
      {'    '}
      <Text color={amountColor}>{amount.padStart(12)}</Text>
      <Text dimColor> {sample.datetime.substring(0, 10)}</Text>
      {peer && (
        <Text dimColor>
          {' '}
          {peerLabel} {truncateAddress(peer)}
        </Text>
      )}
      {sample.transactionHash && <Text dimColor> tx {truncateAddress(sample.transactionHash)}</Text>}
    </Text>
  );
};

const FeeSampleRow: FC<{ sample: { amount: string; datetime: string; transactionHash?: string | undefined } }> = ({
  sample,
}) => {
  const amount = formatSignedAmount(sample.amount);
  return (
    <Text>
      {'    '}
      <Text color="yellow">{amount.padStart(12)}</Text>
      <Text dimColor> {sample.datetime.substring(0, 10)}</Text>
      {sample.transactionHash && <Text dimColor> tx {truncateAddress(sample.transactionHash)}</Text>}
    </Text>
  );
};

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
