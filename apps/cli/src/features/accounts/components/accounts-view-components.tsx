/**
 * Accounts view TUI components
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

import { handleAccountsKeyboardInput, accountsViewReducer } from './accounts-view-controller.js';
import type {
  AccountViewItem,
  AccountsViewState,
  ChildAccountViewItem,
  SessionViewItem,
  TypeCounts,
} from './accounts-view-state.js';

export const CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Accounts · N total · type counts"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: 7, // account detail panel
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
  const cols = createColumns(accounts, {
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
            cols={cols}
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

// ─── Row ────────────────────────────────────────────────────────────────────

const AccountRow: FC<{
  cols: Columns<AccountViewItem, 'acctId' | 'source' | 'type'>;
  isSelected: boolean;
  item: AccountViewItem;
}> = ({ item, isSelected, cols }) => {
  const cursor = getSelectionCursor(isSelected);
  const { acctId, source, type } = cols.format(item);
  const identifier = truncateIdentifier(item.identifier, item.accountType, 28);
  const sessions = item.sessionCount !== undefined ? `${item.sessionCount} sess` : '';
  const { icon, iconColor } = getVerificationDisplay(item.verificationStatus);
  const children = item.childAccounts ? ` +${item.childAccounts.length}` : '';

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {acctId} {source} {type} {identifier} {sessions}
        {children} {icon}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} {acctId} <Text color="cyan">{source}</Text> <Text dimColor>{type}</Text> {identifier}{' '}
      <Text dimColor>
        {sessions}
        {children}
      </Text>{' '}
      <Text color={iconColor}>{icon}</Text>
    </Text>
  );
};

// ─── Detail Panel ───────────────────────────────────────────────────────────

const AccountDetailPanel: FC<{ state: AccountsViewState }> = ({ state }) => {
  const selected = state.accounts[state.selectedIndex];
  if (!selected) return null;

  const type = formatAccountType(selected.accountType);
  const { icon, iconColor, label } = getVerificationDisplay(selected.verificationStatus);

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text>
        <Text bold>▸ #{selected.id}</Text> <Text color="cyan">{selected.sourceName}</Text> <Text dimColor>{type}</Text>
      </Text>

      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Identifier: </Text>
        <Text>{selected.identifier}</Text>
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Provider: </Text>
        {selected.providerName ? <Text color="cyan">{selected.providerName}</Text> : <Text dimColor>—</Text>}
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Created: </Text>
        <Text dimColor>{formatTimestamp(selected.createdAt)}</Text>
      </Text>

      <Text> </Text>
      <Text>
        {'  '}
        <Text dimColor>Verification: </Text>
        <Text color={iconColor}>
          {icon} {label}
        </Text>
      </Text>
      {selected.lastBalanceCheckAt && (
        <Text>
          {'  '}
          <Text dimColor>Last check: </Text>
          <Text dimColor>{formatTimestamp(selected.lastBalanceCheckAt)}</Text>
        </Text>
      )}
      {selected.sessionCount !== undefined && (
        <Text>
          {'  '}
          <Text dimColor>Sessions: </Text>
          <Text>{selected.sessionCount}</Text>
        </Text>
      )}

      {selected.childAccounts && selected.childAccounts.length > 0 && (
        <ChildAccountsSection children={selected.childAccounts} />
      )}

      {selected.sessions && selected.sessions.length > 0 && <SessionsSection sessions={selected.sessions} />}
    </Box>
  );
};

const ChildAccountsSection: FC<{ children: ChildAccountViewItem[] }> = ({ children }) => {
  return (
    <>
      <Text> </Text>
      <Text dimColor>
        {'  '}Derived addresses ({children.length})
      </Text>
      {children.slice(0, 5).map((child) => {
        const { icon, iconColor } = getVerificationDisplay(child.verificationStatus);
        const sessions = child.sessionCount !== undefined ? `${child.sessionCount} sess` : '';
        return (
          <Text key={child.id}>
            {'    '}#{child.id} {truncateIdentifier(child.identifier, 'blockchain', 32)}{' '}
            <Text dimColor>{sessions}</Text> <Text color={iconColor}>{icon}</Text>
          </Text>
        );
      })}
      {children.length > 5 && (
        <Text dimColor>
          {'    '}...and {children.length - 5} more
        </Text>
      )}
    </>
  );
};

const SessionsSection: FC<{ sessions: SessionViewItem[] }> = ({ sessions }) => {
  return (
    <>
      <Text> </Text>
      <Text dimColor>{'  '}Recent sessions</Text>
      {sessions.slice(0, 5).map((session) => {
        const { icon, iconColor } = getSessionDisplay(session.status);
        const completed = session.completedAt ? ` → ${formatTimestamp(session.completedAt)}` : ' → —';
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
      })}
      {sessions.length > 5 && (
        <Text dimColor>
          {'    '}...and {sessions.length - 5} more
        </Text>
      )}
    </>
  );
};

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

function getVerificationDisplay(status: 'match' | 'mismatch' | 'never-checked' | undefined): {
  icon: string;
  iconColor: string;
  label: string;
} {
  switch (status) {
    case 'match':
      return { icon: '✓', iconColor: 'green', label: 'verified' };
    case 'mismatch':
      return { icon: '✗', iconColor: 'red', label: 'mismatch' };
    case 'never-checked':
      return { icon: '⊘', iconColor: 'dim', label: 'never checked' };
    default:
      return { icon: '·', iconColor: 'dim', label: 'unknown' };
  }
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
