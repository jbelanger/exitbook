/**
 * Accounts view TUI components
 */

import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useReducer, type FC, type ReactElement } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  type Columns,
  createColumns,
  Divider,
  FixedHeightDetail,
  SelectableRow,
} from '../../../ui/shared/index.js';
import { StoredBalanceAssetsView } from '../../shared/stored-balance-assets-view.js';
import type { StoredBalanceAssetViewItem } from '../../shared/stored-balance-view.js';
import type {
  AccountDetailViewItem,
  AccountViewItem,
  ChildAccountViewItem,
  SessionViewItem,
} from '../accounts-view-model.js';

import { handleAccountsKeyboardInput, accountsViewReducer } from './accounts-view-controller.js';
import {
  ACCOUNT_FINGERPRINT_REF_LENGTH,
  buildTypeParts,
  formatAccountFingerprintRef,
  formatAccountType,
  formatImportCount,
  formatTimestamp,
  getProjectionDisplay,
  getSessionDisplay,
  getVerificationDisplay,
  truncateIdentifier,
  truncateLabel,
} from './accounts-view-formatters.js';
import type { AccountsListViewState, AccountsViewState } from './accounts-view-state.js';

const ACCOUNT_DETAIL_LINES = 10;

export const CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Accounts · N total · type counts"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: ACCOUNT_DETAIL_LINES, // account detail panel
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

/**
 * Main accounts view app component
 */
export const AccountsViewApp: FC<{
  initialState: AccountsViewState;
  onQuit: () => void;
}> = ({ initialState, onQuit }) => {
  const [state, dispatch] = useReducer(accountsViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  useInput((input, key) => {
    handleAccountsKeyboardInput(input, key, state, dispatch, onQuit, terminalHeight);
  });

  if (state.view === 'assets') {
    return (
      <StoredBalanceAssetsView
        isDrilledDown={state.parentState !== undefined}
        state={state}
        terminalHeight={terminalHeight}
        terminalWidth={terminalWidth}
      />
    );
  }

  if (state.accounts.length === 0) {
    return (
      <AccountsEmptyState
        state={state}
        onQuit={onQuit}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <AccountsHeader state={state} />
      <Text> </Text>
      <AccountList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <AccountDetailPanel state={state} />
      <Text> </Text>
      <ControlsBar />
    </Box>
  );
};

// ─── Header ─────────────────────────────────────────────────────────────────

const AccountsHeader: FC<{ state: AccountsListViewState }> = ({ state }) => {
  const { typeCounts, filters, totalCount } = state;

  let filterLabel = '';
  if (filters.platformFilter) filterLabel = ` (${filters.platformFilter})`;
  else if (filters.typeFilter) filterLabel = ` (${filters.typeFilter})`;

  const typeParts = buildTypeParts(typeCounts);

  return (
    <Box>
      <Text bold>Accounts{filterLabel}</Text>
      <Text dimColor> </Text>
      <Text dimColor>{totalCount} total</Text>
      {typeParts.map((part) => (
        <Text
          key={part.label}
          dimColor
        >
          {' · '}
          {part.count} {part.label}
        </Text>
      ))}
      {filters.showSessions && <Text dimColor>{' · '}sessions visible</Text>}
    </Box>
  );
};

// ─── List ───────────────────────────────────────────────────────────────────

const AccountList: FC<{ state: AccountsListViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { accounts, selectedIndex, scrollOffset } = state;
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);
  const columns = createColumns(accounts, {
    accountRef: {
      format: (item) => formatAccountFingerprintRef(item.accountFingerprint),
      align: 'left',
      minWidth: ACCOUNT_FINGERPRINT_REF_LENGTH,
    },
    platform: { format: (item) => item.platformKey, minWidth: 12 },
    type: { format: (item) => formatAccountType(item.accountType), minWidth: 13 },
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
            key={item.accountFingerprint}
            item={item}
            isSelected={actualIndex === selectedIndex}
            columns={columns}
          />
        );
      })}
      {Array.from({ length: Math.max(0, visibleRows - visible.length) }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {accounts.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

// ─── Row ────────────────────────────────────────────────────────────────────

const AccountRow: FC<{
  columns: Columns<AccountViewItem, 'accountRef' | 'platform' | 'type'>;
  isSelected: boolean;
  item: AccountViewItem;
}> = ({ item, isSelected, columns }) => {
  const { accountRef, platform, type } = columns.format(item);
  const label = truncateLabel(item.name ?? item.identifier, item.name ? 20 : 28);
  const identifierSuffix = item.name ? truncateIdentifier(item.identifier, item.accountType, 16) : undefined;
  const imports = item.sessionCount !== undefined ? formatImportCount(item.sessionCount) : '';
  const projection = getProjectionDisplay(item.balanceProjectionStatus);
  const verification = getVerificationDisplay(item.verificationStatus);
  const children = item.childAccounts && item.childAccounts.length > 0 ? ` +${item.childAccounts.length} derived` : '';

  return (
    <SelectableRow isSelected={isSelected}>
      {accountRef} <Text color="cyan">{platform}</Text> <Text dimColor>{type}</Text>{' '}
      <Text bold={!!item.name}>{label}</Text>
      {identifierSuffix ? (
        <>
          <Text> </Text>
          <Text dimColor>{identifierSuffix}</Text>
        </>
      ) : null}{' '}
      <Text dimColor>
        {imports}
        {children}
      </Text>{' '}
      <Text dimColor>proj:</Text>
      <Text color={projection.iconColor}>{projection.listLabel}</Text>
      <Text> </Text>
      <Text dimColor>ver:</Text>
      <Text color={verification.iconColor}>{verification.listLabel}</Text>
    </SelectableRow>
  );
};

// ─── Detail Panel ───────────────────────────────────────────────────────────

const AccountDetailPanel: FC<{ state: AccountsListViewState }> = ({ state }) => {
  const selectedSummary = state.accounts[state.selectedIndex];
  if (!selectedSummary) return null;
  const selectedDetail = state.accountDetailsById?.[selectedSummary.id];

  return (
    <FixedHeightDetail
      height={ACCOUNT_DETAIL_LINES}
      rows={buildAccountDetailRows(selectedSummary, selectedDetail)}
      overflowRow={(hiddenRowCount) => (
        <Text dimColor>
          {`  ... ${hiddenRowCount} more detail line${hiddenRowCount === 1 ? '' : 's'}. Rerun with --json for full details.`}
        </Text>
      )}
    />
  );
};

function buildAccountDetailRows(selected: AccountViewItem, detail?: AccountDetailViewItem): ReactElement[] {
  const account = detail ?? selected;
  const type = formatAccountType(account.accountType);
  const verification = getVerificationDisplay(account.verificationStatus);
  const projection = getProjectionDisplay(account.balanceProjectionStatus);
  const fingerprintRef = formatAccountFingerprintRef(account.accountFingerprint);
  const title = account.name ? account.name : fingerprintRef;
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {title}</Text>
      {account.name ? <Text dimColor> {fingerprintRef}</Text> : null} <Text color="cyan">{account.platformKey}</Text>{' '}
      <Text dimColor>{type}</Text>
    </Text>,
    <Text key="blank-1"> </Text>,
    <Text key="name">
      {'  '}
      <Text dimColor>Name: </Text>
      {account.name ? <Text>{account.name}</Text> : <Text dimColor>—</Text>}
    </Text>,
    <Text key="identifier">
      {'  '}
      <Text dimColor>Identifier: </Text>
      <Text>{account.identifier}</Text>
    </Text>,
    <Text key="fingerprint">
      {'  '}
      <Text dimColor>Fingerprint: </Text>
      <Text>{account.accountFingerprint}</Text>
    </Text>,
    <Text key="provider">
      {'  '}
      <Text dimColor>Provider: </Text>
      {account.providerName ? <Text color="cyan">{account.providerName}</Text> : <Text dimColor>—</Text>}
    </Text>,
    <Text key="created">
      {'  '}
      <Text dimColor>Created: </Text>
      <Text dimColor>{formatTimestamp(account.createdAt)}</Text>
    </Text>,
    <Text key="blank-2"> </Text>,
    <Text key="verification">
      {'  '}
      <Text dimColor>Verification: </Text>
      <Text color={verification.iconColor}>
        {verification.icon} {verification.label}
      </Text>
      <Text dimColor> · Projection: </Text>
      <Text color={projection.iconColor}>
        {projection.icon} {projection.label}
      </Text>
    </Text>,
  ];

  if (account.lastCalculatedAt) {
    rows.push(
      <Text key="last-calculated">
        {'  '}
        <Text dimColor>Last calculated: </Text>
        <Text dimColor>{formatTimestamp(account.lastCalculatedAt)}</Text>
      </Text>
    );
  }

  if (account.lastRefreshAt) {
    rows.push(
      <Text key="last-refresh">
        {'  '}
        <Text dimColor>Last refresh: </Text>
        <Text dimColor>{formatTimestamp(account.lastRefreshAt)}</Text>
      </Text>
    );
  }

  if (account.sessionCount !== undefined) {
    rows.push(
      <Text key="imports-count">
        {'  '}
        <Text dimColor>Imports: </Text>
        <Text>{formatImportCount(account.sessionCount)}</Text>
      </Text>
    );
  }

  if (detail?.requestedAccount) {
    rows.push(
      <Text key="requested-account">
        {'  '}
        <Text dimColor>Requested: </Text>
        <Text>
          {detail.requestedAccount.name ?? formatAccountFingerprintRef(detail.requestedAccount.accountFingerprint)}
        </Text>
        <Text dimColor> · </Text>
        <Text color="cyan">{detail.requestedAccount.platformKey}</Text>
        <Text dimColor> {formatAccountType(detail.requestedAccount.accountType)}</Text>
      </Text>,
      <Text key="balance-scope">
        {'  '}
        <Text dimColor>Balance scope: </Text>
        <Text>
          {detail.balance.scopeAccount.name ??
            formatAccountFingerprintRef(detail.balance.scopeAccount.accountFingerprint)}
        </Text>
        <Text dimColor> · </Text>
        <Text color="cyan">{detail.balance.scopeAccount.platformKey}</Text>
        <Text dimColor> {formatAccountType(detail.balance.scopeAccount.accountType)}</Text>
      </Text>
    );
  }

  if (detail) {
    rows.push(...buildStoredBalancePreviewRows(detail));
  }

  if (account.childAccounts && account.childAccounts.length > 0) {
    rows.push(...buildChildAccountRows(account.childAccounts));
  }

  if (account.sessions && account.sessions.length > 0) {
    rows.push(...buildSessionRows(account.sessions));
  }

  return rows;
}

function buildStoredBalancePreviewRows(detail: AccountDetailViewItem): ReactElement[] {
  if (!detail.balance.readable) {
    return [
      <Text key="balances-blank"> </Text>,
      <Text
        key="balances-label"
        dimColor
      >
        {'  '}Balances
      </Text>,
      <Text key="balances-reason">
        {'  '}Stored balance snapshot is not readable: {detail.balance.reason}.
      </Text>,
      <Text
        key="balances-hint"
        dimColor
      >
        {'  '}Hint: {detail.balance.hint}.
      </Text>,
    ];
  }

  const rows: ReactElement[] = [
    <Text key="balances-blank"> </Text>,
    <Text
      key="balances-label"
      dimColor
    >
      {'  '}Balances ({detail.balance.assets.length})
    </Text>,
  ];

  if (detail.balance.statusReason) {
    rows.push(
      <Text
        key="balances-status"
        color="yellow"
      >
        {'  '}! {detail.balance.statusReason}
      </Text>
    );
  }

  if (detail.balance.suggestion) {
    rows.push(
      <Text
        key="balances-suggestion"
        dimColor
      >
        {'  '}Suggestion: {detail.balance.suggestion}
      </Text>
    );
  }

  rows.push(
    ...detail.balance.assets.map((asset) => (
      <StoredBalanceAssetPreviewRow
        key={asset.assetId}
        asset={asset}
      />
    ))
  );

  if (detail.balance.assets.length > 0) {
    rows.push(
      <Text
        key="balances-drilldown"
        dimColor
      >
        {'  '}Press enter to drill down
      </Text>
    );
  }

  return rows;
}

const StoredBalanceAssetPreviewRow: FC<{ asset: StoredBalanceAssetViewItem }> = ({ asset }) => {
  const amountColor = asset.isNegative ? 'red' : 'green';
  const liveBalance = asset.liveBalance;

  return (
    <Text>
      {'    '}
      <Text bold>{asset.assetSymbol}</Text>
      <Text dimColor> calc </Text>
      <Text color={amountColor}>{asset.calculatedBalance}</Text>
      {liveBalance !== undefined && (
        <>
          <Text dimColor> · last verified live </Text>
          <Text color={amountColor}>{liveBalance}</Text>
        </>
      )}
      {asset.comparisonStatus !== undefined && (
        <>
          <Text dimColor> · status </Text>
          <Text
            color={
              asset.comparisonStatus === 'match' ? 'green' : asset.comparisonStatus === 'mismatch' ? 'red' : 'yellow'
            }
          >
            {asset.comparisonStatus}
          </Text>
        </>
      )}
    </Text>
  );
};

function buildChildAccountRows(children: ChildAccountViewItem[]): ReactElement[] {
  const rows: ReactElement[] = [
    <Text key="children-blank"> </Text>,
    <Text
      key="children-label"
      dimColor
    >
      {'  '}Derived addresses ({children.length})
    </Text>,
  ];

  rows.push(
    ...children.map((child) => {
      const projection = getProjectionDisplay(child.balanceProjectionStatus);
      const verification = getVerificationDisplay(child.verificationStatus);
      const imports = child.sessionCount !== undefined ? formatImportCount(child.sessionCount) : '';
      const fingerprintRef = formatAccountFingerprintRef(child.accountFingerprint);
      return (
        <Text key={`child-${child.accountFingerprint}`}>
          {'    '}
          {fingerprintRef} {truncateIdentifier(child.identifier, 'blockchain', 32)} <Text dimColor>{imports}</Text>{' '}
          <Text dimColor>proj:</Text>
          <Text color={projection.iconColor}>{projection.listLabel}</Text>
          <Text> </Text>
          <Text dimColor>ver:</Text>
          <Text color={verification.iconColor}>{verification.listLabel}</Text>
        </Text>
      );
    })
  );

  return rows;
}

function buildSessionRows(sessions: SessionViewItem[]): ReactElement[] {
  const rows: ReactElement[] = [
    <Text key="sessions-blank"> </Text>,
    <Text
      key="sessions-label"
      dimColor
    >
      {'  '}Recent sessions
    </Text>,
  ];

  rows.push(
    ...sessions.map((session) => {
      const { icon, iconColor } = getSessionDisplay(session.status);
      const completed = session.completedAt ? ` -> ${formatTimestamp(session.completedAt)}` : ' -> -';
      return (
        <Text key={`session-${session.id}`}>
          {'    '}
          <Text color={iconColor}>{icon}</Text> #{session.id} <Text color={iconColor}>{session.status}</Text>{' '}
          <Text dimColor>
            {formatTimestamp(session.startedAt)}
            {completed}
          </Text>
        </Text>
      );
    })
  );

  return rows;
}

// ─── Controls & Empty State ─────────────────────────────────────────────────

const ControlsBar: FC = () => {
  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · Enter balances · q/esc quit</Text>;
};

const AccountsEmptyState: FC<{ onQuit: () => void; state: AccountsListViewState }> = ({ state, onQuit }) => {
  const { filters, totalCount } = state;
  const hasFilters = filters.platformFilter || filters.typeFilter;

  useEffect(() => {
    const timeout = setTimeout(() => {
      onQuit();
    }, 100);

    return () => {
      clearTimeout(timeout);
    };
  }, [onQuit]);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <AccountsHeader state={state} />
      <Text> </Text>
      {!hasFilters && totalCount === 0 ? (
        <Box flexDirection="column">
          <Text>No accounts found.</Text>
          <Text> </Text>
          <Text dimColor>Tip: exitbook accounts add my-wallet --blockchain ethereum --address 0x...</Text>
        </Box>
      ) : (
        <Text>
          No accounts found{filters.platformFilter ? ` for ${filters.platformFilter}` : ''}
          {filters.typeFilter ? ` of type ${filters.typeFilter}` : ''}.
        </Text>
      )}
      <Text> </Text>
    </Box>
  );
};
