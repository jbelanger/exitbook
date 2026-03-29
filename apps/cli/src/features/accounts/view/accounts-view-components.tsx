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
import type { AccountViewItem, ChildAccountViewItem, SessionViewItem } from '../accounts-view-model.js';

import { handleAccountsKeyboardInput, accountsViewReducer } from './accounts-view-controller.js';
import {
  buildTypeParts,
  formatAccountType,
  formatImportCount,
  formatTimestamp,
  getProjectionDisplay,
  getSessionDisplay,
  getVerificationDisplay,
  truncateIdentifier,
  truncateLabel,
} from './accounts-view-formatters.js';
import type { AccountsViewState } from './accounts-view-state.js';

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
    handleAccountsKeyboardInput(input, key, dispatch, onQuit, terminalHeight);
  });

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

const AccountsHeader: FC<{ state: AccountsViewState }> = ({ state }) => {
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

const AccountList: FC<{ state: AccountsViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { accounts, selectedIndex, scrollOffset } = state;
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);
  const columns = createColumns(accounts, {
    acctId: { format: (item) => `#${item.id}`, align: 'right', minWidth: 5 },
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
  columns: Columns<AccountViewItem, 'acctId' | 'platform' | 'type'>;
  isSelected: boolean;
  item: AccountViewItem;
}> = ({ item, isSelected, columns }) => {
  const { acctId, platform, type } = columns.format(item);
  const label = truncateLabel(item.name ?? item.identifier, item.name ? 20 : 28);
  const identifierSuffix = item.name ? truncateIdentifier(item.identifier, item.accountType, 16) : undefined;
  const imports = item.sessionCount !== undefined ? formatImportCount(item.sessionCount) : '';
  const projection = getProjectionDisplay(item.balanceProjectionStatus);
  const verification = getVerificationDisplay(item.verificationStatus);
  const children = item.childAccounts && item.childAccounts.length > 0 ? ` +${item.childAccounts.length} derived` : '';

  return (
    <SelectableRow isSelected={isSelected}>
      {acctId} <Text color="cyan">{platform}</Text> <Text dimColor>{type}</Text> <Text bold={!!item.name}>{label}</Text>
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

const AccountDetailPanel: FC<{ state: AccountsViewState }> = ({ state }) => {
  const selected = state.accounts[state.selectedIndex];
  if (!selected) return null;

  return (
    <FixedHeightDetail
      height={ACCOUNT_DETAIL_LINES}
      rows={buildAccountDetailRows(selected)}
      overflowRow={(hiddenRowCount) => (
        <Text dimColor>
          {`  ... ${hiddenRowCount} more detail line${hiddenRowCount === 1 ? '' : 's'}. Rerun with --json for full details.`}
        </Text>
      )}
    />
  );
};

function buildAccountDetailRows(selected: AccountViewItem): ReactElement[] {
  const type = formatAccountType(selected.accountType);
  const verification = getVerificationDisplay(selected.verificationStatus);
  const projection = getProjectionDisplay(selected.balanceProjectionStatus);
  const title = selected.name ? selected.name : `#${selected.id}`;
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {title}</Text>
      {selected.name ? <Text dimColor> #{selected.id}</Text> : null} <Text color="cyan">{selected.platformKey}</Text>{' '}
      <Text dimColor>{type}</Text>
    </Text>,
    <Text key="blank-1"> </Text>,
    <Text key="name">
      {'  '}
      <Text dimColor>Name: </Text>
      {selected.name ? <Text>{selected.name}</Text> : <Text dimColor>—</Text>}
    </Text>,
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
      <Text key="imports-count">
        {'  '}
        <Text dimColor>Imports: </Text>
        <Text>{formatImportCount(selected.sessionCount)}</Text>
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
      const imports = child.sessionCount !== undefined ? formatImportCount(child.sessionCount) : '';
      return (
        <Text key={`child-${child.id}`}>
          {'    '}#{child.id} {truncateIdentifier(child.identifier, 'blockchain', 32)} <Text dimColor>{imports}</Text>{' '}
          <Text dimColor>proj:</Text>
          <Text color={projection.iconColor}>{projection.listLabel}</Text>
          <Text> </Text>
          <Text dimColor>ver:</Text>
          <Text color={verification.iconColor}>{verification.listLabel}</Text>
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

const AccountsEmptyState: FC<{ onQuit: () => void; state: AccountsViewState }> = ({ state, onQuit }) => {
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
