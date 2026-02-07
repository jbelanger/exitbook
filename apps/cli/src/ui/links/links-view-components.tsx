/**
 * Links view TUI components
 */

import type { LinkStatus, MatchCriteria } from '@exitbook/accounting';
import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useReducer, type FC } from 'react';

import type { LinkGapAssetSummary, LinkGapIssue } from '../../features/links/links-gap-utils.js';

import { handleKeyboardInput, linksViewReducer } from './links-view-controller.js';
import type {
  LinkWithTransactions,
  LinksViewGapsState,
  LinksViewLinksState,
  LinksViewState,
} from './links-view-state.js';

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
    handleKeyboardInput(input, key, dispatch, onQuit, terminalHeight, state.mode);
  });

  // Handle pending actions with useEffect (links mode only)
  useEffect(() => {
    if (state.mode === 'links' && state.pendingAction && onAction) {
      const { linkId, action } = state.pendingAction;

      void onAction(linkId, action)
        .then(() => {
          dispatch({ type: 'CLEAR_ERROR' });
        })
        .catch((error: unknown) => {
          dispatch({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) });
        });
    }
  }, [state.mode === 'links' ? state.pendingAction : undefined, onAction]);

  // Branch on mode
  if (state.mode === 'gaps') {
    return (
      <GapsView
        state={state}
        terminalHeight={terminalHeight}
        terminalWidth={terminalWidth}
      />
    );
  }

  return (
    <LinksView
      state={state}
      terminalHeight={terminalHeight}
      terminalWidth={terminalWidth}
    />
  );
};

// ─── Links Mode Components ──────────────────────────────────────────────────

/**
 * Links mode view
 */
const LinksView: FC<{
  state: LinksViewLinksState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  // Empty state
  if (state.links.length === 0) {
    return <LinksEmptyState state={state} />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <LinksHeader state={state} />
      <Text> </Text>
      <LinkList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <LinkDetailPanel state={state} />
      {state.error && (
        <>
          <Text> </Text>
          <Text>
            <Text color="yellow">⚠</Text> {state.error}
          </Text>
        </>
      )}
      <Text> </Text>
      <LinksControlsBar state={state} />
    </Box>
  );
};

/**
 * Header component - title and counts (links mode)
 */
const LinksHeader: FC<{ state: LinksViewLinksState }> = ({ state }) => {
  const { counts, statusFilter, totalCount } = state;

  const title = statusFilter ? `Transaction Links (${statusFilter})` : 'Transaction Links';

  const shouldShowStatus = (status: LinkStatus): boolean => {
    return (!statusFilter || statusFilter === status) && (counts[status] > 0 || statusFilter === status);
  };

  const countParts: string[] = [];
  if (shouldShowStatus('confirmed')) {
    countParts.push(`${counts.confirmed} confirmed`);
  }
  if (shouldShowStatus('suggested')) {
    countParts.push(`${counts.suggested} suggested`);
  }
  if (shouldShowStatus('rejected')) {
    countParts.push(`${counts.rejected} rejected`);
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
            <Text dimColor>{countParts[0]}</Text>
          ) : (
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
const LinkList: FC<{ state: LinksViewLinksState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { links, selectedIndex, scrollOffset } = state;

  const visibleRows = Math.max(1, terminalHeight - 14);

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, links.length);
  const visibleLinks = links.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < links.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}▲ {startIndex} more above
        </Text>
      )}
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

  const shortId = link.id.substring(0, 8);
  const asset = link.assetSymbol.padEnd(5).substring(0, 5);
  const sourceAmount = formatAmount(link.sourceAmount.toFixed(), 15);
  const targetAmount = formatAmount(link.targetAmount.toFixed(), 15);
  const confidence = formatConfidenceScore(link.confidenceScore.toNumber());
  const status = link.status.padEnd(9);

  const sourceName = sourceTransaction?.source || 'unknown';
  const targetName = targetTransaction?.source || 'unknown';
  const sourceTarget = `${sourceName} → ${targetName}`.padEnd(30);

  const { icon, iconColor } = getStatusDisplay(link.status);

  const cursor = isSelected ? '▸' : ' ';

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {icon} {shortId} {asset} {sourceAmount} <Text dimColor>→</Text> {targetAmount} {sourceTarget}{' '}
        {confidence} {status}
      </Text>
    );
  }

  if (link.status === 'rejected') {
    return (
      <Text dimColor>
        {cursor} {icon} {shortId} {asset} {sourceAmount} → {targetAmount} {sourceTarget} {confidence} {status}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} <Text color={iconColor}>{icon}</Text> {shortId} {asset} <Text color="green">{sourceAmount}</Text>{' '}
      <Text dimColor>→</Text> <Text color="green">{targetAmount}</Text> <Text color="cyan">{sourceTarget}</Text>{' '}
      {confidence} {status}
    </Text>
  );
};

/**
 * Detail panel component - shows selected link details (links mode)
 */
const LinkDetailPanel: FC<{ state: LinksViewLinksState }> = ({ state }) => {
  const { links, selectedIndex, verbose } = state;
  const selected = links[selectedIndex];

  if (!selected) {
    return null;
  }

  const { link, sourceTransaction, targetTransaction } = selected;

  const shortId = link.id.substring(0, 8);
  const linkType = link.linkType.replace(/_/g, ' ');
  const confidence = formatConfidenceScore(link.confidenceScore.toNumber());
  const confidenceColor = getConfidenceColor(link.confidenceScore.toNumber());
  const { iconColor: statusColor } = getStatusDisplay(link.status);

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text>
        <Text bold>▸ {shortId}</Text> {link.assetSymbol} <Text dimColor>{linkType}</Text>{' '}
        <Text color={confidenceColor}>{confidence}</Text> <Text color={statusColor}>{link.status}</Text>
      </Text>
      <Text> </Text>
      <TransactionLine
        label="Source"
        transaction={sourceTransaction}
        txId={link.sourceTransactionId}
        amount={link.sourceAmount.toFixed()}
        asset={link.assetSymbol}
        direction="OUT"
      />
      <TransactionLine
        label="Target"
        transaction={targetTransaction}
        txId={link.targetTransactionId}
        amount={link.targetAmount.toFixed()}
        asset={link.assetSymbol}
        direction="IN"
      />
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
      <Text> </Text>
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
 * Controls bar component - keyboard hints (links mode)
 */
const LinksControlsBar: FC<{ state: LinksViewLinksState }> = ({ state }) => {
  const selected = state.links[state.selectedIndex];
  const canAction = selected?.link.status === 'suggested';

  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End{canAction && ' · c confirm · r reject'} · q/esc quit</Text>;
};

/**
 * Empty state component (links mode)
 */
const LinksEmptyState: FC<{ state: LinksViewLinksState }> = ({ state }) => {
  const { statusFilter, counts } = state;
  const totalLinks = counts.confirmed + counts.suggested + counts.rejected;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <LinksHeader state={state} />
      <Text> </Text>
      {totalLinks === 0 && !statusFilter ? (
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
        <Text>No {statusFilter || ''} links found.</Text>
      )}
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

// ─── Gaps Mode Components ───────────────────────────────────────────────────

/**
 * Gaps mode view
 */
const GapsView: FC<{
  state: LinksViewGapsState;
  terminalHeight: number;
  terminalWidth: number;
}> = ({ state, terminalHeight, terminalWidth }) => {
  const { linkAnalysis } = state;

  // Empty state
  if (linkAnalysis.issues.length === 0) {
    return <GapsEmptyState state={state} />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <GapsHeader state={state} />
      <Text> </Text>
      <AssetBreakdown assets={linkAnalysis.summary.assets} />
      <Text> </Text>
      <GapList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <GapDetailPanel state={state} />
      <Text> </Text>
      <GapsControlsBar />
    </Box>
  );
};

/**
 * Header component (gaps mode)
 */
const GapsHeader: FC<{ state: LinksViewGapsState }> = ({ state }) => {
  const { summary } = state.linkAnalysis;

  return (
    <Box>
      <Text bold>Transaction Links (gaps)</Text>
      <Text> </Text>
      <Text color={summary.uncovered_inflows > 0 ? 'yellow' : 'green'}>
        {summary.uncovered_inflows} uncovered inflow{summary.uncovered_inflows !== 1 ? 's' : ''}
      </Text>
      <Text dimColor> · </Text>
      <Text color={summary.unmatched_outflows > 0 ? 'yellow' : 'green'}>
        {summary.unmatched_outflows} unmatched outflow{summary.unmatched_outflows !== 1 ? 's' : ''}
      </Text>
    </Box>
  );
};

/**
 * Asset breakdown component - per-asset summary
 */
const AssetBreakdown: FC<{ assets: LinkGapAssetSummary[] }> = ({ assets }) => {
  if (assets.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Text bold>{'  '}Asset Breakdown</Text>
      {assets.map((asset) => (
        <AssetBreakdownRow
          key={asset.assetSymbol}
          asset={asset}
        />
      ))}
    </Box>
  );
};

/**
 * Single asset breakdown row
 */
const AssetBreakdownRow: FC<{ asset: LinkGapAssetSummary }> = ({ asset }) => {
  const parts: React.ReactNode[] = [];

  if (asset.inflowOccurrences > 0) {
    parts.push(
      <Text key="inflow">
        {asset.inflowOccurrences} inflow{asset.inflowOccurrences !== 1 ? 's' : ''} missing{' '}
        <Text color="green">{asset.inflowMissingAmount}</Text> {asset.assetSymbol}
      </Text>
    );
  }

  if (asset.outflowOccurrences > 0) {
    if (parts.length > 0) {
      parts.push(
        <Text
          key="sep"
          dimColor
        >
          {' '}
          ·{' '}
        </Text>
      );
    }
    parts.push(
      <Text key="outflow">
        {asset.outflowOccurrences} outflow{asset.outflowOccurrences !== 1 ? 's' : ''} unmatched for{' '}
        <Text color="green">{asset.outflowMissingAmount}</Text> {asset.assetSymbol}
      </Text>
    );
  }

  return (
    <Text>
      {'    '}
      {asset.assetSymbol.padEnd(8)}
      {parts}
    </Text>
  );
};

/**
 * Gap list component with scrolling support
 */
const GapList: FC<{ state: LinksViewGapsState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { linkAnalysis, selectedIndex, scrollOffset } = state;
  const issues = linkAnalysis.issues;

  // Account for extra lines from asset breakdown (~4 lines)
  const visibleRows = Math.max(1, terminalHeight - 18);

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, issues.length);
  const visibleIssues = issues.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < issues.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}▲ {startIndex} more above
        </Text>
      )}
      {visibleIssues.map((issue, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <GapRow
            key={`${issue.transactionId}-${issue.assetSymbol}-${issue.direction}`}
            issue={issue}
            isSelected={actualIndex === selectedIndex}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {issues.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

/**
 * Individual gap row component
 */
const GapRow: FC<{ isSelected: boolean; issue: LinkGapIssue }> = ({ issue, isSelected }) => {
  const cursor = isSelected ? '▸' : ' ';
  const txId = `#${issue.transactionId}`.padStart(6);
  const source = (issue.blockchain ?? issue.source).padEnd(10).substring(0, 10);
  const timestamp = issue.timestamp.substring(0, 16).replace('T', ' ');
  const asset = issue.assetSymbol.padEnd(5).substring(0, 5);
  const dir = issue.direction === 'inflow' ? 'IN ' : 'OUT';
  const dirColor = issue.direction === 'inflow' ? 'green' : 'yellow';
  const coverage = formatCoverage(issue.confirmedCoveragePercent);

  if (isSelected) {
    return (
      <Text bold>
        {cursor} <Text color="yellow">⚠</Text> {txId} {source} <Text dimColor>{timestamp}</Text> {asset}{' '}
        <Text color={dirColor}>{dir}</Text> <Text color="green">{issue.missingAmount}</Text> <Text dimColor>of</Text>{' '}
        <Text>{issue.totalAmount}</Text> {coverage}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} <Text color="yellow">⚠</Text> {txId} <Text color="cyan">{source}</Text> <Text dimColor>{timestamp}</Text>{' '}
      {asset} <Text color={dirColor}>{dir}</Text> <Text color="green">{issue.missingAmount}</Text>{' '}
      <Text dimColor>of</Text> <Text>{issue.totalAmount}</Text> {coverage}
    </Text>
  );
};

/**
 * Detail panel for selected gap issue
 */
const GapDetailPanel: FC<{ state: LinksViewGapsState }> = ({ state }) => {
  const issue = state.linkAnalysis.issues[state.selectedIndex];

  if (!issue) {
    return null;
  }

  const txId = `#${issue.transactionId}`;
  const source = issue.blockchain ?? issue.source;
  const operation = `${issue.operationCategory}/${issue.operationType}`;
  const directionLabel = issue.direction === 'inflow' ? 'inflow' : 'outflow';
  const coverageNum = parseFloat(issue.confirmedCoveragePercent);
  const coverageColor = getCoverageColor(coverageNum);

  const actionText =
    issue.direction === 'inflow'
      ? 'Run `exitbook links run` then confirm matches to bridge this gap.'
      : 'Identify the destination wallet or confirm a link; otherwise this may be treated as a gift.';

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text>
        <Text bold>▸ {txId}</Text> <Text color="cyan">{source}</Text> <Text dimColor>{operation}</Text>{' '}
        <Text dimColor>{issue.timestamp}</Text>
      </Text>

      <Text>
        {'  '}
        <Text dimColor>Missing: </Text>
        <Text color="green">{issue.missingAmount}</Text> {issue.assetSymbol} <Text dimColor>of</Text>{' '}
        {issue.totalAmount} {issue.assetSymbol} {directionLabel} <Text dimColor>(</Text>
        <Text color={coverageColor}>{issue.confirmedCoveragePercent}%</Text>
        <Text dimColor> confirmed coverage)</Text>
      </Text>

      <Text>
        {'  '}
        <Text dimColor>Suggested matches: </Text>
        {issue.suggestedCount > 0 ? (
          <Text>
            <Text color="green">{issue.suggestedCount}</Text>
            {issue.highestSuggestedConfidencePercent && (
              <Text>
                {' '}
                (best{' '}
                <Text color={getConfidenceColor(parseFloat(issue.highestSuggestedConfidencePercent) / 100)}>
                  {issue.highestSuggestedConfidencePercent}%
                </Text>{' '}
                confidence)
              </Text>
            )}
          </Text>
        ) : (
          <Text dimColor>none</Text>
        )}
      </Text>

      <Text>
        {'  '}
        <Text dimColor>Action: </Text>
        {actionText}
      </Text>
    </Box>
  );
};

/**
 * Controls bar (gaps mode - read-only, no c/r)
 */
const GapsControlsBar: FC = () => {
  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · q/esc quit</Text>;
};

/**
 * Empty state component (gaps mode)
 */
const GapsEmptyState: FC<{ state: LinksViewGapsState }> = ({ state }) => {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <GapsHeader state={state} />
      <Text> </Text>
      <Text>{'  '}All movements have confirmed counterparties.</Text>
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

// ─── Shared Components ──────────────────────────────────────────────────────

/**
 * Divider component - full-width separator
 */
const Divider: FC<{ width: number }> = ({ width }) => {
  const line = '─'.repeat(width);
  return <Text dimColor>{line}</Text>;
};

// ─── Helper Functions ───────────────────────────────────────────────────────

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

function formatAmount(amount: string, width: number): string {
  const num = parseFloat(amount);
  if (isNaN(num)) {
    return amount.padStart(width);
  }

  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  return formatted.padStart(width);
}

function formatConfidenceScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`.padStart(6);
}

function getConfidenceColor(score: number): string {
  if (score >= 0.95) return 'green';
  if (score >= 0.7) return 'yellow';
  return 'red';
}

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

function formatCoverage(coveragePercent: string): string {
  const num = parseFloat(coveragePercent);
  return `${Math.round(num)}% covered`;
}

function getCoverageColor(percent: number): string {
  if (percent >= 50) return 'green';
  if (percent > 0) return 'yellow';
  return 'red';
}
