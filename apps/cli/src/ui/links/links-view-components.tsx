/**
 * Links view TUI components
 */

import type { LinkStatus, MatchCriteria } from '@exitbook/accounting';
import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useReducer, type FC } from 'react';

import { handleKeyboardInput, linksViewReducer } from './links-view-controller.js';
import type { LinkWithTransactions, LinksViewState } from './links-view-state.js';

/**
 * Main links view app component
 */
export const LinksViewApp: FC<{
  initialState: LinksViewState;
  onAction?: (linkId: string, action: 'confirm' | 'reject') => Promise<void>;
  onQuit: () => void;
}> = ({ initialState, onAction, onQuit }) => {
  // Set up state management
  const [state, dispatch] = useReducer(linksViewReducer, initialState);

  // Get terminal dimensions for scrolling calculations
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  // Handle keyboard input
  useInput((input, key) => {
    handleKeyboardInput(input, key, dispatch, onQuit, terminalHeight);
  });

  // Handle pending actions with useEffect
  useEffect(() => {
    if (state.pendingAction && onAction) {
      const { linkId, action } = state.pendingAction;

      // Execute action and handle result
      void onAction(linkId, action)
        .then(() => {
          // Clear pending action on success
          dispatch({ type: 'CLEAR_ERROR' });
        })
        .catch((error: unknown) => {
          // Set error on failure
          dispatch({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) });
        });
    }
  }, [state.pendingAction, onAction]);

  // Empty state
  if (state.links.length === 0) {
    return <EmptyState state={state} />;
  }

  // Normal view
  return (
    <Box flexDirection="column">
      {/* Blank line before header */}
      <Text> </Text>

      {/* Header */}
      <Header state={state} />

      {/* Blank line after header */}
      <Text> </Text>

      {/* Link list with scrolling */}
      <LinkList
        state={state}
        terminalHeight={terminalHeight}
      />

      {/* Divider */}
      <Divider width={terminalWidth} />

      {/* Detail panel */}
      <DetailPanel state={state} />

      {/* Error message if present */}
      {state.error && (
        <>
          <Text> </Text>
          <Text>
            <Text color="yellow">⚠</Text> {state.error}
          </Text>
        </>
      )}

      {/* Blank line before controls */}
      <Text> </Text>

      {/* Controls bar */}
      <ControlsBar state={state} />
    </Box>
  );
};

/**
 * Header component - title and counts
 */
const Header: FC<{ state: LinksViewState }> = ({ state }) => {
  const { counts, statusFilter, totalCount } = state;

  // Build title with optional filter indicator
  const title = statusFilter ? `Transaction Links (${statusFilter})` : 'Transaction Links';

  // Build counts display
  const countParts: string[] = [];
  if (statusFilter === 'confirmed' || !statusFilter) {
    if (counts.confirmed > 0 || statusFilter === 'confirmed') {
      countParts.push(`${counts.confirmed} confirmed`);
    }
  }
  if (statusFilter === 'suggested' || !statusFilter) {
    if (counts.suggested > 0 || statusFilter === 'suggested') {
      countParts.push(`${counts.suggested} suggested`);
    }
  }
  if (statusFilter === 'rejected' || !statusFilter) {
    if (counts.rejected > 0 || statusFilter === 'rejected') {
      countParts.push(`${counts.rejected} rejected`);
    }
  }

  const displayedCount = counts.confirmed + counts.suggested + counts.rejected;
  const isLimited = totalCount !== undefined && totalCount > displayedCount;

  return (
    <Box>
      <Text bold>{title}</Text>
      {displayedCount > 0 && (
        <>
          <Text> </Text>
          {statusFilter ? (
            // Filtered view - just show the count
            <Text dimColor>{countParts[0]}</Text>
          ) : (
            // Full view - show all counts with colored separators
            <Text>
              {counts.confirmed > 0 && <Text color="green">{counts.confirmed} confirmed</Text>}
              {counts.confirmed > 0 && (counts.suggested > 0 || counts.rejected > 0) && <Text dimColor> · </Text>}
              {counts.suggested > 0 && <Text color="yellow">{counts.suggested} suggested</Text>}
              {counts.suggested > 0 && counts.rejected > 0 && <Text dimColor> · </Text>}
              {counts.rejected > 0 && <Text dimColor>{counts.rejected} rejected</Text>}
            </Text>
          )}
          {isLimited && (
            <>
              <Text dimColor> · </Text>
              <Text dimColor>
                showing {displayedCount} of {totalCount}
              </Text>
            </>
          )}
        </>
      )}
    </Box>
  );
};

/**
 * Link list component with scrolling support
 */
const LinkList: FC<{ state: LinksViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { links, selectedIndex, scrollOffset } = state;

  // Calculate visible height: terminal height minus fixed chrome
  // Header area (3) + divider (1) + detail panel (6) + controls area (2) + scroll indicators (2) = 14
  const visibleRows = Math.max(1, terminalHeight - 14);

  // Calculate visible window
  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, links.length);
  const visibleLinks = links.slice(startIndex, endIndex);

  // Check if we need scroll indicators
  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < links.length;

  return (
    <Box flexDirection="column">
      {/* Top scroll indicator */}
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}▲ {startIndex} more above
        </Text>
      )}

      {/* Visible links */}
      {visibleLinks.map((item, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <LinkRow
            key={item.link.id}
            item={item}
            isSelected={actualIndex === selectedIndex}
          />
        );
      })}

      {/* Bottom scroll indicator */}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {links.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

/**
 * Individual link row component
 */
const LinkRow: FC<{ isSelected: boolean; item: LinkWithTransactions }> = ({ item, isSelected }) => {
  const { link, sourceTransaction, targetTransaction } = item;

  // Extract display data
  const shortId = link.id.substring(0, 8);
  const asset = link.assetSymbol.padEnd(5).substring(0, 5);
  const sourceAmount = formatAmount(link.sourceAmount.toFixed(), 15);
  const targetAmount = formatAmount(link.targetAmount.toFixed(), 15);
  const confidence = formatConfidenceScore(link.confidenceScore.toNumber());
  const status = link.status.padEnd(9);

  // Get source and target names
  const sourceName = sourceTransaction?.source || 'unknown';
  const targetName = targetTransaction?.source || 'unknown';
  const sourceTarget = `${sourceName} → ${targetName}`.padEnd(30);

  // Icon and color based on status
  const { icon, iconColor } = getStatusDisplay(link.status);

  // Cursor indicator
  const cursor = isSelected ? '▸' : ' ';

  // Apply selection styling to entire row
  if (isSelected) {
    return (
      <Text bold>
        {cursor} {icon} {shortId} {asset} {sourceAmount} <Text dimColor>→</Text> {targetAmount} {sourceTarget}{' '}
        {confidence} {status}
      </Text>
    );
  }

  // Apply dimming to rejected links
  if (link.status === 'rejected') {
    return (
      <Text dimColor>
        {cursor} {icon} {shortId} {asset} {sourceAmount} → {targetAmount} {sourceTarget} {confidence} {status}
      </Text>
    );
  }

  // Normal row (confirmed or suggested)
  return (
    <Text>
      {cursor} <Text color={iconColor}>{icon}</Text> {shortId} {asset} <Text color="green">{sourceAmount}</Text>{' '}
      <Text dimColor>→</Text> <Text color="green">{targetAmount}</Text> <Text color="cyan">{sourceTarget}</Text>{' '}
      {confidence} {status}
    </Text>
  );
};

/**
 * Divider component - full-width separator
 */
const Divider: FC<{ width: number }> = ({ width }) => {
  const line = '─'.repeat(width);
  return <Text dimColor>{line}</Text>;
};

/**
 * Detail panel component - shows selected link details
 */
const DetailPanel: FC<{ state: LinksViewState }> = ({ state }) => {
  const { links, selectedIndex, verbose } = state;
  const selected = links[selectedIndex];

  if (!selected) {
    return null;
  }

  const { link, sourceTransaction, targetTransaction } = selected;

  // First line: selected ID, asset, link type, confidence, status
  const shortId = link.id.substring(0, 8);
  const linkType = link.linkType.replace(/_/g, ' ');
  const confidence = formatConfidenceScore(link.confidenceScore.toNumber());
  const confidenceColor = getConfidenceColor(link.confidenceScore.toNumber());
  const { icon: _statusIcon, iconColor: statusColor } = getStatusDisplay(link.status);

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      {/* Header line */}
      <Text>
        <Text bold>▸ {shortId}</Text> {link.assetSymbol} <Text dimColor>{linkType}</Text>{' '}
        <Text color={confidenceColor}>{confidence}</Text> <Text color={statusColor}>{link.status}</Text>
      </Text>

      {/* Blank line */}
      <Text> </Text>

      {/* Source transaction */}
      <TransactionLine
        label="Source"
        transaction={sourceTransaction}
        txId={link.sourceTransactionId}
        amount={link.sourceAmount.toFixed()}
        asset={link.assetSymbol}
        direction="OUT"
      />

      {/* Target transaction */}
      <TransactionLine
        label="Target"
        transaction={targetTransaction}
        txId={link.targetTransactionId}
        amount={link.targetAmount.toFixed()}
        asset={link.assetSymbol}
        direction="IN"
      />

      {/* Address details (verbose mode) */}
      {verbose && (sourceTransaction?.from || targetTransaction?.to) && (
        <>
          {sourceTransaction?.from && (
            <Text>
              {'          '}
              <Text dimColor>from: </Text>
              {sourceTransaction.from}
            </Text>
          )}
          {targetTransaction?.to && (
            <Text>
              {'          '}
              <Text dimColor>to: </Text>
              {targetTransaction.to}
            </Text>
          )}
        </>
      )}

      {/* Blank line */}
      <Text> </Text>

      {/* Match criteria */}
      <Text>
        {'  '}
        <Text dimColor>Match: </Text>
        {formatMatchCriteria(link.matchCriteria)}
      </Text>
    </Box>
  );
};

/**
 * Transaction line component for detail panel
 */
const TransactionLine: FC<{
  amount: string;
  asset: string;
  direction: 'IN' | 'OUT';
  label: string;
  transaction: { datetime: string; source: string } | undefined;
  txId: number;
}> = ({ label, txId, transaction, direction, amount, asset }) => {
  const sourceName = transaction?.source || 'unknown';
  const timestamp = transaction?.datetime || '?';
  const directionColor = direction === 'IN' ? 'green' : 'yellow';

  return (
    <Text>
      {'  '}
      <Text dimColor>{label}: </Text>#{txId} <Text color="cyan">{sourceName}</Text> <Text dimColor>{timestamp}</Text>{' '}
      <Text color={directionColor}>{direction}</Text> <Text color="green">{amount}</Text> {asset}
    </Text>
  );
};

/**
 * Controls bar component - keyboard hints
 */
const ControlsBar: FC<{ state: LinksViewState }> = ({ state }) => {
  const selected = state.links[state.selectedIndex];
  const canAction = selected?.link.status === 'suggested';

  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End{canAction && ' · c confirm · r reject'} · q/esc quit</Text>;
};

/**
 * Empty state component
 */
const EmptyState: FC<{ state: LinksViewState }> = ({ state }) => {
  const { statusFilter, counts } = state;
  const totalLinks = counts.confirmed + counts.suggested + counts.rejected;

  return (
    <Box flexDirection="column">
      {/* Blank line before header */}
      <Text> </Text>

      {/* Header */}
      <Header state={state} />

      {/* Blank line after header */}
      <Text> </Text>

      {/* Empty message */}
      {totalLinks === 0 && !statusFilter ? (
        // No links at all (and no filter applied)
        <Box flexDirection="column">
          <Text>No transaction links found.</Text>
          <Text> </Text>
          <Text>Run the linking algorithm first:</Text>
          <Text>
            {'  '}
            <Text dimColor>exitbook links run</Text>
          </Text>
        </Box>
      ) : (
        // No links matching filter (or filtered and empty)
        <Text>No {statusFilter || ''} links found.</Text>
      )}

      {/* Blank line before controls */}
      <Text> </Text>

      {/* Controls bar */}
      <Text dimColor>q quit</Text>
    </Box>
  );
};

/**
 * Helper: Get status icon and color
 */
function getStatusDisplay(status: LinkStatus): { icon: string; iconColor: string } {
  switch (status) {
    case 'confirmed':
      return { icon: '✓', iconColor: 'green' };
    case 'suggested':
      return { icon: '⚠', iconColor: 'yellow' };
    case 'rejected':
      return { icon: '✗', iconColor: 'dim' };
    default:
      return { icon: '•', iconColor: 'white' };
  }
}

/**
 * Helper: Format amount for display with right alignment
 */
function formatAmount(amount: string, width: number): string {
  // Parse and format with locale
  const num = parseFloat(amount);
  if (isNaN(num)) {
    return amount.padStart(width);
  }

  // Format with commas if large enough
  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  return formatted.padStart(width);
}

/**
 * Helper: Format confidence score as percentage
 */
function formatConfidenceScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`.padStart(6);
}

/**
 * Helper: Get confidence color based on score
 */
function getConfidenceColor(score: number): string {
  if (score >= 0.95) return 'green';
  if (score >= 0.7) return 'yellow';
  return 'red';
}

/**
 * Helper: Format match criteria for display
 */
function formatMatchCriteria(criteria: MatchCriteria): string {
  const parts: string[] = [];

  if (criteria.assetMatch) {
    parts.push('asset');
  }

  const amountSimilarity =
    typeof criteria.amountSimilarity === 'string'
      ? parseFloat(criteria.amountSimilarity)
      : criteria.amountSimilarity.toNumber();
  parts.push(`amount ${(amountSimilarity * 100).toFixed(1)}%`);

  if (criteria.timingValid) {
    const timingHours =
      typeof criteria.timingHours === 'string' ? parseFloat(criteria.timingHours) : criteria.timingHours;
    parts.push(`timing ${timingHours.toFixed(2)}h`);
  }

  if (criteria.addressMatch) {
    parts.push('address');
  }

  return parts.join(' · ');
}
