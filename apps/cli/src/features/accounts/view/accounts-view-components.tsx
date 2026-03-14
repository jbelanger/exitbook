/**
 * Accounts view TUI components
 */

import { Box, Text, useInput, useStdout } from 'ink';
import { useReducer, type FC, type ReactElement } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  type Columns,
  createColumns,
  Divider,
  FixedHeightDetail,
  SelectableRow,
} from '../../../ui/shared/index.js';
import type {
  AccountViewItem,
  AccountsViewState,
  ChildAccountViewItem,
  SessionViewItem,
  TypeCounts,
} from '../view/accounts-view-state.js';

import { handleAccountsKeyboardInput, accountsViewReducer } from './accounts-view-controller.js';

const ACCOUNT_DETAIL_LINES = 7;

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
    handleAccountsKeyboardInput(input, key, dispatch, onQuit, terminalHeight);
  });

  if (state.accounts.length === 0) {
    return <AccountsEmptyState state={state} />;
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

const AccountsHeader: FC<{ state: AccountsViewState }> = ({ state }) => {
  const { typeCounts, filters, totalCount } = state;

  let filterLabel = '';
  if (filters.sourceFilter) filterLabel = ` (${filters.sourceFilter})`;
  else if (filters.typeFilter) filterLabel = ` (${filters.typeFilter})`;

  const typeParts = buildTypeParts(typeCounts);

  return (
    <Box>
      <Text bold>Accounts{filterLabel}</Text>
      <Text> </Text>
      <Text>{totalCount} total</Text>
      {typeParts.length > 0 && (
        <>
          <Text dimColor> · </Text>
          {typeParts.map((part, i) => (
            <Text key={part.label}>
              {i > 0 && <Text dimColor> · </Text>}
              {part.count} <Text dimColor>{part.label}</Text>
            </Text>
          ))}
        </>
      )}
      {filters.showSessions && (
        <>
          <Text dimColor> · </Text>
          <Text dimColor>sessions visible</Text>
        </>
      )}
    </Box>
  );
};

function buildTypeParts(counts: TypeCounts): { count: number; label: string }[] {
  const parts: { count: number; label: string }[] = [];
  if (counts.blockchain > 0) parts.push({ label: 'blockchain', count: counts.blockchain });
  if (counts.exchangeApi > 0) parts.push({ label: 'exchange-api', count: counts.exchangeApi });
  if (counts.exchangeCsv > 0) parts.push({ label: 'exchange-csv', count: counts.exchangeCsv });
  return parts;
}

// ─── List ───────────────────────────────────────────────────────────────────

const AccountList: FC<{ state: AccountsViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { accounts, selectedIndex, scrollOffset } = state;
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);
  const columns = createColumns(accounts, {
    acctId: { format: (item) => `#${item.id}`, align: 'right', minWidth: 5 },
    source: { format: (item) => item.sourceName, minWidth: 12 },
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
            key={item.id}
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
  columns: Columns<AccountViewItem, 'acctId' | 'source' | 'type'>;
  isSelected: boolean;
  item: AccountViewItem;
}> = ({ item, isSelected, columns }) => {
  const { acctId, source, type } = columns.format(item);
  const identifier = truncateIdentifier(item.identifier, item.accountType, 28);
  const sessions = item.sessionCount !== undefined ? `${item.sessionCount} sess` : '';
  const projection = getProjectionDisplay(item.balanceProjectionStatus);
  const verification = getVerificationDisplay(item.verificationStatus);
  const children = item.childAccounts ? ` +${item.childAccounts.length}` : '';

  return (
    <SelectableRow isSelected={isSelected}>
      {acctId} <Text color="cyan">{source}</Text> <Text dimColor>{type}</Text> {identifier}{' '}
      <Text dimColor>
        {sessions}
        {children}
      </Text>{' '}
      <Text color={projection.iconColor}>{projection.icon}</Text>
      <Text dimColor>proj</Text> <Text color={verification.iconColor}>{verification.icon}</Text>
      <Text dimColor>ver</Text>
    </SelectableRow>
  );
};

// ─── Detail Panel ───────────────────────────────────────────────────────────

const AccountDetailPanel: FC<{ state: AccountsViewState }> = ({ state }) => {
  const selected = state.accounts[state.selectedIndex];
  if (!selected) return null;

  return (
    <FixedHeightDetail
      height={ACCOUNT_DETAIL_LINES}
      rows={buildAccountDetailRows(selected)}
    />
  );
};

function buildAccountDetailRows(selected: AccountViewItem): ReactElement[] {
  const type = formatAccountType(selected.accountType);
  const verification = getVerificationDisplay(selected.verificationStatus);
  const projection = getProjectionDisplay(selected.balanceProjectionStatus);
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ #{selected.id}</Text> <Text color="cyan">{selected.sourceName}</Text> <Text dimColor>{type}</Text>
    </Text>,
    <Text key="blank-1"> </Text>,
    <Text key="identifier">
      {'  '}
      <Text dimColor>Identifier: </Text>
      <Text>{selected.identifier}</Text>
    </Text>,
    <Text key="provider">
      {'  '}
      <Text dimColor>Provider: </Text>
      {selected.providerName ? <Text color="cyan">{selected.providerName}</Text> : <Text dimColor>—</Text>}
    </Text>,
    <Text key="created">
      {'  '}
      <Text dimColor>Created: </Text>
      <Text dimColor>{formatTimestamp(selected.createdAt)}</Text>
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

  if (selected.lastRefreshAt) {
    rows.push(
      <Text key="last-refresh">
        {'  '}
        <Text dimColor>Last refresh: </Text>
        <Text dimColor>{formatTimestamp(selected.lastRefreshAt)}</Text>
      </Text>
    );
  }
  if (selected.sessionCount !== undefined) {
    rows.push(
      <Text key="sessions">
        {'  '}
        <Text dimColor>Sessions: </Text>
        <Text>{selected.sessionCount}</Text>
      </Text>
    );
  }
  if (selected.childAccounts && selected.childAccounts.length > 0) {
    rows.push(...buildChildAccountRows(selected.childAccounts));
  }
  if (selected.sessions && selected.sessions.length > 0) {
    rows.push(...buildSessionRows(selected.sessions));
  }

  return rows;
}

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
    ...children.slice(0, 5).map((child) => {
      const projection = getProjectionDisplay(child.balanceProjectionStatus);
      const verification = getVerificationDisplay(child.verificationStatus);
      const sessions = child.sessionCount !== undefined ? `${child.sessionCount} sess` : '';
      return (
        <Text key={child.id}>
          {'    '}#{child.id} {truncateIdentifier(child.identifier, 'blockchain', 32)} <Text dimColor>{sessions}</Text>{' '}
          <Text color={projection.iconColor}>{projection.icon}</Text>
          <Text dimColor>proj</Text> <Text color={verification.iconColor}>{verification.icon}</Text>
          <Text dimColor>ver</Text>
        </Text>
      );
    })
  );

  if (children.length > 5) {
    rows.push(
      <Text
        key="children-more"
        dimColor
      >
        {'    '}...and {children.length - 5} more
      </Text>
    );
  }

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
    ...sessions.slice(0, 5).map((session) => {
      const { icon, iconColor } = getSessionDisplay(session.status);
      const completed = session.completedAt ? ` -> ${formatTimestamp(session.completedAt)}` : ' -> -';
      return (
        <Text key={session.id}>
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

  if (sessions.length > 5) {
    rows.push(
      <Text
        key="sessions-more"
        dimColor
      >
        {'    '}...and {sessions.length - 5} more
      </Text>
    );
  }

  return rows;
}

// ─── Controls & Empty State ─────────────────────────────────────────────────

const ControlsBar: FC = () => {
  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · q/esc quit</Text>;
};

const AccountsEmptyState: FC<{ state: AccountsViewState }> = ({ state }) => {
  const { filters, totalCount } = state;
  const hasFilters = filters.sourceFilter || filters.typeFilter;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <AccountsHeader state={state} />
      <Text> </Text>
      {!hasFilters && totalCount === 0 ? (
        <Box flexDirection="column">
          <Text>{'  '}No accounts found.</Text>
          <Text> </Text>
          <Text>{'  '}Import data first:</Text>
          <Text dimColor>{'  '}exitbook import --exchange kucoin --csv-dir ./exports/kraken</Text>
        </Box>
      ) : (
        <Text>
          {'  '}No accounts found{filters.sourceFilter ? ` for ${filters.sourceFilter}` : ''}
          {filters.typeFilter ? ` of type ${filters.typeFilter}` : ''}.
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAccountType(accountType: string): string {
  switch (accountType) {
    case 'blockchain':
      return 'blockchain';
    case 'exchange-api':
      return 'exchange-api';
    case 'exchange-csv':
      return 'exchange-csv';
    default:
      return accountType;
  }
}

function getVerificationDisplay(status: AccountViewItem['verificationStatus']): {
  icon: string;
  iconColor: string;
  label: string;
} {
  switch (status) {
    case 'match':
      return { icon: '✓', iconColor: 'green', label: 'verified' };
    case 'warning':
      return { icon: '!', iconColor: 'yellow', label: 'warning' };
    case 'mismatch':
      return { icon: '✗', iconColor: 'red', label: 'mismatch' };
    case 'unavailable':
      return { icon: '?', iconColor: 'yellow', label: 'unavailable' };
    case 'never-checked':
      return { icon: '⊘', iconColor: 'dim', label: 'never checked' };
    case undefined:
      return { icon: '·', iconColor: 'dim', label: 'unknown' };
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
}

function getProjectionDisplay(status: AccountViewItem['balanceProjectionStatus']): {
  icon: string;
  iconColor: string;
  label: string;
} {
  switch (status) {
    case 'fresh':
      return { icon: '✓', iconColor: 'green', label: 'fresh' };
    case 'stale':
      return { icon: '!', iconColor: 'yellow', label: 'stale' };
    case 'building':
      return { icon: '~', iconColor: 'cyan', label: 'building' };
    case 'failed':
      return { icon: '✗', iconColor: 'red', label: 'failed' };
    case 'never-built':
      return { icon: '⊘', iconColor: 'dim', label: 'never built' };
    case undefined:
      return { icon: '·', iconColor: 'dim', label: 'unknown' };
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
}

function getSessionDisplay(status: string): { icon: string; iconColor: string } {
  switch (status) {
    case 'completed':
      return { icon: '✓', iconColor: 'green' };
    case 'failed':
      return { icon: '✗', iconColor: 'red' };
    case 'started':
      return { icon: '⏳', iconColor: 'yellow' };
    case 'cancelled':
      return { icon: '⊘', iconColor: 'dim' };
    default:
      return { icon: '•', iconColor: 'dim' };
  }
}

function truncateIdentifier(identifier: string, accountType: string, maxWidth: number): string {
  if (identifier.length <= maxWidth) return identifier.padEnd(maxWidth);

  // For blockchain addresses, show prefix...suffix
  if (accountType === 'blockchain') {
    const prefixLen = Math.floor((maxWidth - 3) / 2);
    const suffixLen = maxWidth - 3 - prefixLen;
    return `${identifier.substring(0, prefixLen)}...${identifier.substring(identifier.length - suffixLen)}`;
  }

  // For exchange identifiers, just truncate
  return identifier.substring(0, maxWidth - 3) + '...';
}

function formatTimestamp(isoString: string): string {
  return isoString.replace('T', ' ').replace('Z', '').substring(0, 19);
}
