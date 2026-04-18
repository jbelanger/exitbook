/**
 * Links view TUI components
 */

import type { LinkGapAssetSummary, LinkGapIssue } from '@exitbook/accounting/linking';
import type { LinkStatus } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useReducer, type FC, type ReactElement } from 'react';

import {
  calculateVisibleRows,
  type Columns,
  createColumns,
  Divider,
  FixedHeightDetail,
  SelectableRow,
} from '../../../ui/shared/index.js';
import { formatTransactionFingerprintRef } from '../../transactions/transaction-selector.js';
import { buildLinkProposalRef } from '../link-selector.js';
import type { LinkGapBrowseItem } from '../links-gaps-browse-model.js';
import type { LinkWithTransactions, TransferProposalWithTransactions } from '../links-view-model.js';

import { buildGapOwnershipRouteLabel, getGapOwnershipRouteColor } from './link-gap-ownership-route.js';
import { handleLinksKeyboardInput, linksViewReducer } from './links-view-controller.js';
import {
  countGapItemsWithCrossProfileCandidates,
  countGapSuggestionBuckets,
  formatAmount,
  formatCompactAmount,
  formatConfidenceScore,
  formatCrossProfileProfileLabel,
  formatCoverage,
  formatGapCounterpartTimeDelta,
  formatGapCrossProfileCueLabel,
  formatGapCrossProfileLikelyOutcome,
  formatGapCueLabel,
  formatGapLikelyOutcome,
  formatGapRowTimestamp,
  formatGapSuggestionAvailability,
  formatLinkDate,
  formatLinkTypeDisplay,
  formatMatchCriteria,
  formatNoOpenGapsMessage,
  formatProposalConfidence,
  formatProposalProvenance,
  formatProposalProvenanceDetail,
  formatProposalRoute,
  formatResolvedGapExceptionCount,
  gapIssueSuggestsGapException,
  getExactOtherProfileCounterpart,
  getConfidenceColor,
  getCoverageColor,
  getGapSuggestionColor,
  type LinkAmountDisplay,
  getProposalAmountDisplay,
  getProposalConfidenceColor,
  getStatusDisplay,
  truncateText,
} from './links-view-formatters.js';
import {
  GAP_DETAIL_LINES,
  GAP_TOP_ASSET_LIMIT,
  getGapsChromeLines,
  LINK_DETAIL_LINES,
  LINKS_CHROME_LINES,
} from './links-view-layout.js';
import type { LinksViewGapsState, LinksViewLinksState, LinksViewState } from './links-view-state.js';

const GAP_ROW_ASSET_SYMBOL_MAX_WIDTH = 18;
const GAP_SUMMARY_ASSET_SYMBOL_MAX_WIDTH = 14;
const MAX_MULTI_LEG_DETAIL_ROWS = 3;

/**
 * Main links view app component
 */
export const LinksViewApp: FC<{
  initialState: LinksViewState;
  onAction?: (
    linkId: number,
    action: 'confirm' | 'reject'
  ) => Promise<Result<{ affectedLinkIds: number[]; newStatus: 'confirmed' | 'rejected' }, Error>>;
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
    handleLinksKeyboardInput(
      input,
      key,
      dispatch,
      onQuit,
      terminalHeight,
      state.mode,
      state.mode === 'gaps' ? state.linkAnalysis.summary.assets.length : 0
    );
  });

  // Handle pending actions with useEffect (links mode only)
  useEffect(() => {
    if (state.mode === 'links' && state.pendingAction && onAction) {
      const { linkId, action } = state.pendingAction;

      void onAction(linkId, action).then(
        (result) => {
          if (result.isErr()) {
            dispatch({ type: 'SET_ERROR', error: result.error.message });
            return;
          }

          dispatch({
            type: 'ACTION_SUCCESS',
            affectedLinkIds: result.value.affectedLinkIds,
            newStatus: result.value.newStatus,
          });
        },
        (error: unknown) => {
          dispatch({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) });
        }
      );
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
  if (state.proposals.length === 0) {
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
  const displayedProposalCount = state.proposals.length;
  const displayedLinkCount = countProposalLegs(state.proposals);
  const provenanceSummaryParts = buildProposalProvenanceSummaryParts(state.proposals, statusFilter);
  const effectiveStatusFilter = statusFilter ?? inferSingleStatusFilter(counts);
  const summaryStatus = statusFilter ?? effectiveStatusFilter;
  const filteredSummary =
    summaryStatus !== undefined
      ? buildFilteredProposalSummary(state.proposals, summaryStatus, displayedProposalCount, displayedLinkCount)
      : undefined;

  const title = statusFilter ? `Link Proposals (${statusFilter})` : 'Link Proposals';

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

  const isLimited = totalCount !== undefined && totalCount > displayedProposalCount;

  return (
    <Box>
      <Text bold>{title}</Text>
      {displayedProposalCount > 0 && (
        <>
          <Text> </Text>
          <Text dimColor>
            {filteredSummary ??
              `${displayedProposalCount} proposal${displayedProposalCount !== 1 ? 's' : ''} · ${displayedLinkCount} link${
                displayedLinkCount !== 1 ? 's' : ''
              }${provenanceSummaryParts.length > 0 ? ` · ${provenanceSummaryParts.join(' · ')}` : ''}`}
          </Text>
          {summaryStatus === undefined && countParts.length > 0 && (
            <>
              <Text dimColor> · </Text>
              <Text>
                {counts.confirmed > 0 && <Text color="green">{counts.confirmed} confirmed</Text>}
                {counts.confirmed > 0 && (counts.suggested > 0 || counts.rejected > 0) && <Text dimColor> · </Text>}
                {counts.suggested > 0 && <Text color="yellow">{counts.suggested} suggested</Text>}
                {counts.suggested > 0 && counts.rejected > 0 && <Text dimColor> · </Text>}
                {counts.rejected > 0 && <Text dimColor>{counts.rejected} rejected</Text>}
              </Text>
            </>
          )}
          {isLimited && (
            <>
              <Text dimColor> · </Text>
              <Text dimColor>
                showing {displayedProposalCount} of {totalCount} proposals
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
  const { proposals, selectedIndex, scrollOffset } = state;

  const visibleRows = calculateVisibleRows(terminalHeight, LINKS_CHROME_LINES);
  const columns = createColumns(proposals, {
    date: {
      format: (proposal) => formatLinkDate(proposal.representativeLeg),
      minWidth: 10,
      maxWidth: 10,
    },
    asset: { format: (proposal) => proposal.representativeLink.assetSymbol, minWidth: 5 },
    status: { format: (proposal) => proposal.status, minWidth: 9 },
    sourceTarget: {
      format: (proposal) => formatProposalRoute(proposal),
      minWidth: 30,
      maxWidth: 50,
    },
  });

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, proposals.length);
  const visibleProposals = proposals.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < proposals.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}▲ {startIndex} more above
        </Text>
      )}
      {visibleProposals.map((proposal, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <LinkRow
            key={proposal.proposalKey}
            proposal={proposal}
            isSelected={actualIndex === selectedIndex}
            columns={columns}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {proposals.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

/**
 * Individual link row component
 */
const LinkRow: FC<{
  columns: Columns<TransferProposalWithTransactions, 'date' | 'asset' | 'status' | 'sourceTarget'>;
  isSelected: boolean;
  proposal: TransferProposalWithTransactions;
}> = ({ proposal, isSelected, columns }) => {
  const { date, asset, status, sourceTarget } = columns.format(proposal);
  const amountDisplay = getProposalAmountDisplay(proposal);
  const confidence = formatProposalConfidence(proposal);
  const legCountSuffix = proposal.legs.length > 1 ? ` · ${proposal.legs.length} legs` : '';

  const { icon, iconColor } = getStatusDisplay(proposal.status);

  if (proposal.status === 'rejected') {
    return (
      <SelectableRow
        dimWhenUnselected
        isSelected={isSelected}
      >
        {icon} {date} {asset} {renderAmountSummary(amountDisplay)} {sourceTarget}
        <Text dimColor>{legCountSuffix}</Text>
        <Text dimColor> · </Text>
        {confidence} {status}
      </SelectableRow>
    );
  }

  return (
    <SelectableRow isSelected={isSelected}>
      <Text color={iconColor}>{icon}</Text> {date} {asset} {renderAmountSummary(amountDisplay)}{' '}
      <Text color="cyan">{sourceTarget}</Text>
      <Text dimColor>{legCountSuffix}</Text>
      <Text dimColor> · </Text>
      {confidence} {status}
    </SelectableRow>
  );
};

/**
 * Detail panel component - shows selected link details (links mode)
 */
const LinkDetailPanel: FC<{ state: LinksViewLinksState }> = ({ state }) => {
  const { proposals, selectedIndex, verbose } = state;
  const selected = proposals[selectedIndex];

  if (!selected) {
    return null;
  }

  return (
    <FixedHeightDetail
      height={LINK_DETAIL_LINES}
      rows={buildProposalDetailRows(selected, verbose)}
    />
  );
};

function buildProposalDetailRows(selected: TransferProposalWithTransactions, verbose: boolean): ReactElement[] {
  if (selected.legs.length === 1) {
    return buildSingleLegDetailRows(selected.legs[0]!, selected, verbose);
  }

  return buildMultiLegDetailRows(selected);
}

function buildSingleLegDetailRows(
  selectedLeg: LinkWithTransactions,
  proposal: TransferProposalWithTransactions,
  verbose: boolean
): ReactElement[] {
  const { link, sourceTransaction, targetTransaction } = selectedLeg;
  const proposalRef = buildLinkProposalRef(proposal.proposalKey);
  const linkType = formatLinkTypeDisplay(link, sourceTransaction, targetTransaction);
  const confidence = formatConfidenceScore(link.confidenceScore.toNumber());
  const confidenceColor = getConfidenceColor(link.confidenceScore.toNumber());
  const { iconColor: statusColor } = getStatusDisplay(proposal.status);
  const amountDisplay = getProposalAmountDisplay(proposal);
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {proposalRef}</Text> {link.assetSymbol} <Text dimColor>{linkType}</Text>{' '}
      <Text color={confidenceColor}>{confidence}</Text> <Text color={statusColor}>{proposal.status}</Text>
    </Text>,
    <Text key="blank-1"> </Text>,
    <TransactionLine
      key="source"
      label="Source"
      transaction={sourceTransaction}
      txId={link.sourceTransactionId}
      amount={link.sourceAmount.toFixed()}
      asset={link.assetSymbol}
      direction="OUT"
    />,
    <TransactionLine
      key="target"
      label="Target"
      transaction={targetTransaction}
      txId={link.targetTransactionId}
      amount={link.targetAmount.toFixed()}
      asset={link.assetSymbol}
      direction="IN"
    />,
  ];

  if (verbose && (sourceTransaction?.from || targetTransaction?.to)) {
    if (sourceTransaction?.from) {
      rows.push(
        <Text key="from">
          {'          '}
          <Text dimColor>from: </Text>
          {sourceTransaction.from}
        </Text>
      );
    }
    if (targetTransaction?.to) {
      rows.push(
        <Text key="to">
          {'          '}
          <Text dimColor>to: </Text>
          {targetTransaction.to}
        </Text>
      );
    }
  }

  rows.push(
    <Text key="blank-2"> </Text>,
    <Text key="provenance">
      {'  '}
      <Text dimColor>Provenance: </Text>
      {renderProposalProvenanceLabel(proposal)}
    </Text>,
    <Text key="match">
      {'  '}
      <Text dimColor>Match: </Text>
      {formatMatchCriteria(link.matchCriteria)}
    </Text>
  );

  const provenanceDetail = formatProposalProvenanceDetail(proposal.provenanceSummary);
  if (provenanceDetail) {
    rows.push(
      <Text key="provenance-detail">
        {'  '}
        <Text dimColor>Provenance detail: </Text>
        {provenanceDetail}
      </Text>
    );
  }

  if (amountDisplay.detailSummary) {
    rows.push(
      <Text key="summary">
        {'  '}
        <Text dimColor>{amountDisplay.detailLabel ?? 'Summary:'} </Text>
        {amountDisplay.detailSummary}
      </Text>
    );
  }

  return rows;
}

function buildMultiLegDetailRows(proposal: TransferProposalWithTransactions): ReactElement[] {
  const representativeLeg = proposal.representativeLeg;
  const representativeLink = representativeLeg.link;
  const proposalRef = buildLinkProposalRef(proposal.proposalKey);
  const confidence = formatProposalConfidence(proposal);
  const confidenceColor = getProposalConfidenceColor(proposal);
  const { iconColor: statusColor } = getStatusDisplay(proposal.status);
  const amountDisplay = getProposalAmountDisplay(proposal);
  const visibleLegs = proposal.legs.slice(0, MAX_MULTI_LEG_DETAIL_ROWS);
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {proposalRef}</Text> {representativeLink.assetSymbol} <Text dimColor>transfer proposal</Text>{' '}
      <Text color={confidenceColor}>{confidence}</Text> <Text color={statusColor}>{proposal.status}</Text>
    </Text>,
    <Text key="blank-1"> </Text>,
    <Text key="scope">
      {'  '}
      <Text dimColor>Scope: </Text>
      {proposal.legs.length} legs review together
    </Text>,
    <Text key="provenance">
      {'  '}
      <Text dimColor>Provenance: </Text>
      {renderProposalProvenanceLabel(proposal)}
    </Text>,
    ...visibleLegs.map((leg, index) => (
      <Text key={`leg-${leg.link.id}`}>
        {'  '}
        <Text dimColor>Leg {index + 1}: </Text>
        <Text color="cyan">{leg.sourceTransaction?.platformKey ?? 'unknown'}</Text>{' '}
        <Text dimColor>{leg.sourceTransaction?.datetime ?? '?'}</Text> <Text color="yellow">OUT</Text>{' '}
        <Text color="green">{leg.link.sourceAmount.toFixed()}</Text> {leg.link.assetSymbol} <Text dimColor>→</Text>{' '}
        <Text color="cyan">{leg.targetTransaction?.platformKey ?? 'unknown'}</Text>{' '}
        <Text dimColor>{leg.targetTransaction?.datetime ?? '?'}</Text> <Text color="green">IN</Text>{' '}
        <Text color="green">{leg.link.targetAmount.toFixed()}</Text> {leg.link.assetSymbol}
      </Text>
    )),
  ];

  if (proposal.legs.length > visibleLegs.length) {
    rows.push(
      <Text key="more">
        {'  '}
        <Text dimColor>+{proposal.legs.length - visibleLegs.length} more legs</Text>
      </Text>
    );
  }

  rows.push(
    <Text key="match">
      {'  '}
      <Text dimColor>Match: </Text>
      {formatMatchCriteria(representativeLink.matchCriteria)}
    </Text>
  );

  if (amountDisplay.detailSummary) {
    rows.push(
      <Text key="summary">
        {'  '}
        <Text dimColor>{amountDisplay.detailLabel ?? 'Summary:'} </Text>
        {amountDisplay.detailSummary}
      </Text>
    );
  }

  const provenanceDetail = formatProposalProvenanceDetail(proposal.provenanceSummary);
  if (provenanceDetail) {
    rows.push(
      <Text key="provenance-detail">
        {'  '}
        <Text dimColor>Provenance detail: </Text>
        {provenanceDetail}
      </Text>
    );
  }

  return rows;
}

function renderAmountSummary(display: LinkAmountDisplay) {
  return <Text color="green">{formatAmount(display.linkedAmount, 15)}</Text>;
}

/**
 * Transaction line component for detail panel
 */
const TransactionLine: FC<{
  amount: string;
  asset: string;
  direction: 'IN' | 'OUT';
  label: string;
  transaction: { datetime: string; platformKey: string } | undefined;
  txId: number;
}> = ({ label, txId, transaction, direction, amount, asset }) => {
  const platformKey = transaction?.platformKey || 'unknown';
  const timestamp = transaction?.datetime || '?';
  const directionColor = direction === 'IN' ? 'green' : 'yellow';

  return (
    <Text>
      {'  '}
      <Text dimColor>{label}: </Text>#{txId} <Text color="cyan">{platformKey}</Text> <Text dimColor>{timestamp}</Text>{' '}
      <Text color={directionColor}>{direction}</Text> <Text color="green">{amount}</Text> {asset}
    </Text>
  );
};

/**
 * Controls bar component - keyboard hints (links mode)
 */
const LinksControlsBar: FC<{ state: LinksViewLinksState }> = ({ state }) => {
  const selected = state.proposals[state.selectedIndex];
  const canConfirm =
    selected !== undefined &&
    selected.legs.some((leg) => leg.link.status === 'suggested') &&
    selected.legs.every((leg) => leg.link.status !== 'rejected');
  const canReject = selected !== undefined && selected.legs.some((leg) => leg.link.status !== 'rejected');

  return (
    <Text dimColor>
      ↑↓/j/k · ^U/^D page · Home/End
      {canConfirm && ' · c confirm proposal'}
      {canReject && ' · r reject proposal'}
      {' · q/esc quit'}
    </Text>
  );
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
          <Text>No link proposals found.</Text>
          <Text> </Text>
          <Text>Run the linking algorithm first:</Text>
          <Text>
            {'  '}
            <Text dimColor>exitbook links run</Text>
          </Text>
        </Box>
      ) : (
        <Text>No {statusFilter || ''} proposals found.</Text>
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
      <GapTopAssets assets={linkAnalysis.summary.assets} />
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
  const { withSuggestions, withoutSuggestions } = countGapSuggestionBuckets(state.linkAnalysis.issues);
  const withOtherProfileCounterparts = countGapItemsWithCrossProfileCandidates(state.gaps);

  return (
    <Box flexDirection="column">
      <Text bold>Transaction Links (gaps)</Text>
      <Text>
        <Text color="yellow">{summary.total_issues} gaps</Text>
        {state.hiddenResolvedIssueCount > 0 && (
          <>
            <Text dimColor> · </Text>
            <Text dimColor>{formatResolvedGapExceptionCount(state.hiddenResolvedIssueCount)}</Text>
          </>
        )}
        <Text dimColor> · </Text>
        <Text color={summary.uncovered_inflows > 0 ? 'green' : 'dim'}>
          {summary.uncovered_inflows} uncovered inflow{summary.uncovered_inflows !== 1 ? 's' : ''}
        </Text>
        <Text dimColor> · </Text>
        <Text color={summary.unmatched_outflows > 0 ? 'yellow' : 'dim'}>
          {summary.unmatched_outflows} unmatched outflow{summary.unmatched_outflows !== 1 ? 's' : ''}
        </Text>
        <Text dimColor> · </Text>
        <Text color={withSuggestions > 0 ? 'green' : 'dim'}>{withSuggestions} with suggestions</Text>
        <Text dimColor> · </Text>
        <Text color={withoutSuggestions > 0 ? 'yellow' : 'dim'}>{withoutSuggestions} without suggestions</Text>
        {withOtherProfileCounterparts > 0 && (
          <>
            <Text dimColor> · </Text>
            <Text color="yellow">
              {withOtherProfileCounterparts} with other-profile counterpart
              {withOtherProfileCounterparts === 1 ? '' : 's'}
            </Text>
          </>
        )}
        <Text dimColor> · </Text>
        <Text dimColor>
          {summary.affected_assets} asset{summary.affected_assets !== 1 ? 's' : ''}
        </Text>
      </Text>
    </Box>
  );
};

/**
 * Top assets summary component
 */
const GapTopAssets: FC<{ assets: LinkGapAssetSummary[] }> = ({ assets }) => {
  if (assets.length === 0) {
    return null;
  }

  return (
    <Text>
      {'  '}
      <Text bold>Top Assets: </Text>
      {assets.slice(0, GAP_TOP_ASSET_LIMIT).map((asset, index) => {
        const totalOccurrences = asset.inflowOccurrences + asset.outflowOccurrences;
        return (
          <Text key={asset.assetSymbol}>
            {index > 0 && <Text dimColor> · </Text>}
            <Text color="cyan">{truncateText(asset.assetSymbol, GAP_SUMMARY_ASSET_SYMBOL_MAX_WIDTH)}</Text>{' '}
            <Text color="yellow">{totalOccurrences}</Text>
          </Text>
        );
      })}
      {assets.length > GAP_TOP_ASSET_LIMIT && (
        <>
          <Text dimColor> · </Text>
          <Text dimColor>+{assets.length - GAP_TOP_ASSET_LIMIT} more</Text>
        </>
      )}
    </Text>
  );
};

function renderGapSuggestionSummary(issue: LinkGapIssue): ReactElement {
  if (issue.suggestedCount === 0) {
    return <Text color="yellow">{formatGapSuggestionAvailability(issue)}</Text>;
  }

  return <Text color={getGapSuggestionColor(issue)}>{formatGapSuggestionAvailability(issue)}</Text>;
}

/**
 * Gap list component with scrolling support
 */
const GapList: FC<{ state: LinksViewGapsState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { gaps, linkAnalysis, selectedIndex, scrollOffset } = state;

  const visibleRows = calculateVisibleRows(terminalHeight, getGapsChromeLines(linkAnalysis.summary.assets.length));

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, gaps.length);
  const visibleGaps = gaps.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < gaps.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}▲ {startIndex} more above
        </Text>
      )}
      {visibleGaps.map((gap, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <GapRow
            key={gap.gapRef}
            gap={gap}
            isSelected={actualIndex === selectedIndex}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {gaps.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

/**
 * Individual gap row component
 */
const GapRow: FC<{
  gap: LinkGapBrowseItem;
  isSelected: boolean;
}> = ({ gap, isSelected }) => {
  const { gapIssue: issue } = gap;
  const platform = issue.platformKey;
  const timestamp = formatGapRowTimestamp(issue.timestamp);
  const dir = issue.direction === 'inflow' ? 'IN ' : 'OUT';
  const dirColor = issue.direction === 'inflow' ? 'green' : 'yellow';
  const coverage = parseFloat(issue.confirmedCoveragePercent);
  const hasPartialCoverage = coverage > 0 && coverage < 100;
  const crossProfileCueLabel = formatGapCrossProfileCueLabel(gap);

  return (
    <SelectableRow isSelected={isSelected}>
      <Text color="yellow">⚠</Text> #{issue.transactionId} <Text color="cyan">{platform}</Text>{' '}
      <Text dimColor>{timestamp}</Text> <Text color={dirColor}>{dir}</Text>{' '}
      <Text color="green">{formatCompactAmount(issue.missingAmount)}</Text>{' '}
      {truncateText(issue.assetSymbol, GAP_ROW_ASSET_SYMBOL_MAX_WIDTH)} <Text dimColor>missing</Text>
      {hasPartialCoverage && (
        <>
          <Text dimColor> · </Text>
          <Text color={getCoverageColor(coverage)}>{formatCoverage(issue.confirmedCoveragePercent)}</Text>
        </>
      )}
      {issue.gapCue && (
        <>
          <Text dimColor> · </Text>
          <Text color="cyan">{formatGapCueLabel(issue.gapCue)}</Text>
        </>
      )}
      {issue.contextHint && (
        <>
          <Text dimColor> · </Text>
          <Text color="yellow">{issue.contextHint.label}</Text>
        </>
      )}
      {crossProfileCueLabel && (
        <>
          <Text dimColor> · </Text>
          <Text color="yellow">{crossProfileCueLabel}</Text>
        </>
      )}
      <Text dimColor> · </Text>
      {renderGapSuggestionSummary(issue)}
    </SelectableRow>
  );
};

/**
 * Detail panel for selected gap issue
 */
const GapDetailPanel: FC<{ state: LinksViewGapsState }> = ({ state }) => {
  const selectedGap = state.gaps[state.selectedIndex];

  if (!selectedGap) {
    return null;
  }

  return (
    <FixedHeightDetail
      height={GAP_DETAIL_LINES}
      rows={buildGapDetailRows(selectedGap)}
    />
  );
};

function buildGapDetailRows(gap: LinkGapBrowseItem): ReactElement[] {
  const { gapIssue: issue } = gap;
  const txId = `#${issue.transactionId}`;
  const operation = `${issue.operationCategory}/${issue.operationType}`;
  const directionLabel = issue.direction === 'inflow' ? 'inflow' : 'outflow';
  const coverageNum = parseFloat(issue.confirmedCoveragePercent);
  const coverageColor = getCoverageColor(coverageNum);
  const gapCueCounterpartTransactionRef =
    issue.gapCueCounterpartTxFingerprint !== undefined
      ? formatTransactionFingerprintRef(issue.gapCueCounterpartTxFingerprint)
      : undefined;
  const exactOtherProfileCounterpart = getExactOtherProfileCounterpart(gap);
  const crossProfileCueLabel = formatGapCrossProfileCueLabel(gap);
  const issueSuggestsGapException = gapIssueSuggestsGapException(issue);
  const likelyOutcome =
    formatGapLikelyOutcome(issue, gapCueCounterpartTransactionRef) ?? formatGapCrossProfileLikelyOutcome(gap);

  const actionText =
    issueSuggestsGapException && gapCueCounterpartTransactionRef !== undefined
      ? `Inspect \`exitbook transactions view ${gapCueCounterpartTransactionRef}\`, then resolve this gap if it reflects adjacent non-link activity.`
      : issueSuggestsGapException
        ? `Resolve this gap with \`exitbook links gaps resolve ${gap.gapRef}\` if no direct internal transfer exists.`
        : gapCueCounterpartTransactionRef !== undefined
          ? `Inspect \`exitbook transactions view ${gapCueCounterpartTransactionRef}\` before resolving this gap.`
          : exactOtherProfileCounterpart !== undefined
            ? `Inspect ${exactOtherProfileCounterpart.transactionRef} on profile ${formatCrossProfileProfileLabel(
                exactOtherProfileCounterpart.profileDisplayName,
                exactOtherProfileCounterpart.profileKey
              )} before treating this as a generic same-profile gap.`
            : issue.direction === 'inflow'
              ? 'Run `exitbook links run` then confirm matches to bridge this gap.'
              : 'This may be treated as a gift; identify the destination wallet or confirm a link.';

  return [
    <Text key="title">
      <Text bold>▸ {txId}</Text> <Text color="cyan">{issue.platformKey}</Text> <Text dimColor>{operation}</Text>{' '}
      <Text dimColor>{issue.timestamp}</Text>
    </Text>,
    ...(issue.blockchainName && issue.blockchainName !== issue.platformKey
      ? [
          <Text key="blockchain">
            {'  '}
            <Text dimColor>Blockchain: </Text>
            {issue.blockchainName}
          </Text>,
        ]
      : []),
    ...(gap.transactionSnapshot?.blockchainTransactionHash
      ? [
          <Text key="transaction-hash">
            {'  '}
            <Text dimColor>Blockchain hash: </Text>
            {gap.transactionSnapshot.blockchainTransactionHash}
          </Text>,
        ]
      : []),
    <Text key="missing">
      {'  '}
      <Text dimColor>Gap: </Text>
      <Text color="green">{issue.missingAmount}</Text> {issue.assetSymbol} {directionLabel} <Text dimColor>of</Text>{' '}
      {issue.totalAmount} {issue.assetSymbol}
    </Text>,
    <Text key="coverage">
      {'  '}
      <Text dimColor>Coverage: </Text>
      <Text color={coverageColor}>{issue.confirmedCoveragePercent}%</Text>
      <Text dimColor> confirmed</Text>
    </Text>,
    <Text key="matches">
      {'  '}
      <Text dimColor>Readiness: </Text>
      {issue.suggestedCount > 0 ? (
        <Text>
          <Text color={getGapSuggestionColor(issue)}>{issue.suggestedCount}</Text>
          <Text dimColor> suggested candidate{issue.suggestedCount !== 1 ? 's' : ''}</Text>
          {issue.highestSuggestedConfidencePercent && (
            <Text>
              <Text color={getConfidenceColor(parseFloat(issue.highestSuggestedConfidencePercent) / 100)}>
                {' '}
                · best {issue.highestSuggestedConfidencePercent}%
              </Text>{' '}
            </Text>
          )}
        </Text>
      ) : (
        <Text color="yellow">no suggested candidates</Text>
      )}
    </Text>,
    ...(gap.relatedContext?.fromAccount
      ? [
          <Text key="from-account">
            {'  '}
            <Text dimColor>From account: </Text>
            {formatGapAccountMatch(gap.relatedContext.fromAccount)}
          </Text>,
        ]
      : []),
    ...(gap.relatedContext?.toAccount
      ? [
          <Text key="to-account">
            {'  '}
            <Text dimColor>To account: </Text>
            {formatGapAccountMatch(gap.relatedContext.toAccount)}
          </Text>,
        ]
      : []),
    ...(gap.relatedContext?.openGapRefs !== undefined && gap.relatedContext.openGapRefs.length > 0
      ? [
          <Text key="open-gap-refs">
            {'  '}
            <Text dimColor>Open gap refs: </Text>
            {gap.relatedContext.openGapRefs.join(', ')}
          </Text>,
        ]
      : []),
    ...(gap.relatedContext?.sameHashSiblingTransactionRefs !== undefined &&
    gap.relatedContext.sameHashSiblingTransactionCount !== undefined
      ? [
          <Text key="same-hash-siblings">
            {'  '}
            <Text dimColor>Same-hash sibling txs: </Text>
            {formatGapRelatedTransactionRefs(
              gap.relatedContext.sameHashSiblingTransactionRefs,
              gap.relatedContext.sameHashSiblingTransactionCount
            )}
          </Text>,
        ]
      : []),
    ...(gap.relatedContext?.sharedFromTransactionRefs !== undefined &&
    gap.relatedContext.sharedFromTransactionCount !== undefined
      ? [
          <Text key="shared-from">
            {'  '}
            <Text dimColor>Same from endpoint txs: </Text>
            {formatGapRelatedTransactionRefs(
              gap.relatedContext.sharedFromTransactionRefs,
              gap.relatedContext.sharedFromTransactionCount
            )}
          </Text>,
        ]
      : []),
    ...(gap.relatedContext?.sharedToTransactionRefs !== undefined &&
    gap.relatedContext.sharedToTransactionCount !== undefined
      ? [
          <Text key="shared-to">
            {'  '}
            <Text dimColor>Same to endpoint txs: </Text>
            {formatGapRelatedTransactionRefs(
              gap.relatedContext.sharedToTransactionRefs,
              gap.relatedContext.sharedToTransactionCount
            )}
          </Text>,
        ]
      : []),
    ...(gap.transactionSnapshot?.from
      ? [
          <Text key="from">
            {'  '}
            <Text dimColor>From: </Text>
            {gap.transactionSnapshot.from}
          </Text>,
        ]
      : []),
    ...(gap.transactionSnapshot?.to
      ? [
          <Text key="to">
            {'  '}
            <Text dimColor>To: </Text>
            {gap.transactionSnapshot.to}
          </Text>,
        ]
      : []),
    ...(buildGapOwnershipRouteLabel(gap.transactionSnapshot?.fromOwnership, gap.transactionSnapshot?.toOwnership)
      ? [
          <Text key="ownership">
            {'  '}
            <Text dimColor>Ownership: </Text>
            {renderGapOwnershipRoute(
              buildGapOwnershipRouteLabel(gap.transactionSnapshot?.fromOwnership, gap.transactionSnapshot?.toOwnership)!
            )}
          </Text>,
        ]
      : []),
    ...(gap.transactionSnapshot?.openSameHashGapRowCount !== undefined &&
    gap.transactionSnapshot.openSameHashGapRowCount > 1
      ? [
          <Text key="same-hash-count">
            {'  '}
            <Text dimColor>Open same-hash gap rows: </Text>
            {String(gap.transactionSnapshot.openSameHashGapRowCount)}
          </Text>,
        ]
      : []),
    ...(gap.transactionSnapshot?.openSameHashTransactionRefs !== undefined &&
    gap.transactionSnapshot.openSameHashTransactionRefs.length > 1
      ? [
          <Text key="same-hash-refs">
            {'  '}
            <Text dimColor>Open same-hash tx refs: </Text>
            {gap.transactionSnapshot.openSameHashTransactionRefs.join(', ')}
          </Text>,
        ]
      : []),
    ...(issue.gapCue || crossProfileCueLabel
      ? [
          <Text key="cue">
            {'  '}
            <Text dimColor>Cue: </Text>
            <Text color={issue.gapCue ? 'cyan' : 'yellow'}>
              {issue.gapCue ? formatGapCueLabel(issue.gapCue) : crossProfileCueLabel}
            </Text>
          </Text>,
        ]
      : []),
    ...(gapCueCounterpartTransactionRef !== undefined
      ? [
          <Text key="counterpart-ref">
            {'  '}
            <Text dimColor>Counterpart tx ref: </Text>
            {gapCueCounterpartTransactionRef}
          </Text>,
          <Text key="counterpart-inspect">
            {'  '}
            <Text dimColor>Inspect counterpart: </Text>
            <Text dimColor>`exitbook transactions view ${gapCueCounterpartTransactionRef}`</Text>
          </Text>,
        ]
      : []),
    ...(likelyOutcome
      ? [
          <Text key="likely-outcome">
            {'  '}
            <Text dimColor>Likely outcome: </Text>
            <Text>{likelyOutcome}</Text>
          </Text>,
        ]
      : []),
    ...(issue.contextHint
      ? [
          <Text key="context">
            {'  '}
            <Text dimColor>Context: </Text>
            <Text color="yellow">{issue.contextHint.message}</Text>
          </Text>,
        ]
      : []),
    ...(gap.crossProfileCandidates?.map((candidate, index) => (
      <Text key={`other-profile-${candidate.txFingerprint}`}>
        {'  '}
        <Text dimColor>{index === 0 ? 'Other-profile counterpart: ' : 'Other-profile alt: '}</Text>
        {formatCrossProfileProfileLabel(candidate.profileDisplayName, candidate.profileKey)}
        <Text dimColor> · </Text>
        {candidate.platformKey}
        <Text dimColor> · </Text>
        {candidate.direction === 'inflow' ? 'IN' : 'OUT'} {candidate.amount} {issue.assetSymbol}
        <Text dimColor> · </Text>
        {candidate.transactionRef}
        <Text dimColor> · </Text>
        {formatGapCounterpartTimeDelta(candidate.secondsDeltaFromGap)}
      </Text>
    )) ?? []),
    <Text key="external">
      {'  '}
      <Text dimColor>Reference: </Text>
      {issue.txFingerprint}
    </Text>,
    <Text key="next">
      {'  '}
      <Text dimColor>Next: </Text>
      {actionText}
    </Text>,
    <Text key="hint">
      {'  '}
      <Text dimColor>Review queue: </Text>
      {issue.suggestedCount > 0 ? (
        <Text>
          switch to <Text dimColor>`exitbook links explore --status suggested`</Text> after refreshing links
        </Text>
      ) : issueSuggestsGapException ? (
        <Text>
          use <Text dimColor>`exitbook links gaps resolve ${gap.gapRef}`</Text> if no direct internal transfer exists
        </Text>
      ) : gapCueCounterpartTransactionRef !== undefined ? (
        <Text>
          inspect <Text dimColor>`exitbook transactions view ${gapCueCounterpartTransactionRef}`</Text>, then{' '}
          <Text>decide whether this is a real bridge or an external route</Text>
        </Text>
      ) : exactOtherProfileCounterpart !== undefined ? (
        <Text>
          inspect {exactOtherProfileCounterpart.transactionRef} on profile{' '}
          {formatCrossProfileProfileLabel(
            exactOtherProfileCounterpart.profileDisplayName,
            exactOtherProfileCounterpart.profileKey
          )}{' '}
          first; this may be a cross-profile transfer
        </Text>
      ) : (
        <Text>
          capture the counterparty first, then re-run <Text dimColor>`exitbook links run`</Text>
        </Text>
      )}
    </Text>,
  ];
}

function formatGapAccountMatch(
  accountMatch: NonNullable<NonNullable<LinkGapBrowseItem['relatedContext']>['fromAccount']>
): ReactElement {
  return (
    <Text>
      {accountMatch.accountName ? `${accountMatch.accountName} ` : ''}
      <Text dimColor>({accountMatch.accountRef})</Text> <Text color="cyan">{accountMatch.platformKey}</Text>
    </Text>
  );
}

function formatGapRelatedTransactionRefs(refs: string[], totalCount: number): ReactElement {
  return (
    <Text>
      {refs.join(', ')}
      {totalCount > refs.length ? <Text dimColor>{` (${totalCount} total)`}</Text> : null}
    </Text>
  );
}

function renderGapOwnershipRoute(value: string): ReactElement {
  const color = getGapOwnershipRouteColor(value);
  if (color === 'dim') {
    return <Text dimColor>{value}</Text>;
  }

  return <Text color={color}>{value}</Text>;
}

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
  const emptyMessage = formatNoOpenGapsMessage(state.hiddenResolvedIssueCount);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <GapsHeader state={state} />
      <Text> </Text>
      <Text>
        {'  '}
        {emptyMessage}
      </Text>
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

function renderProposalProvenanceLabel(proposal: TransferProposalWithTransactions): ReactElement {
  const label = formatProposalProvenance(proposal.provenanceSummary);

  switch (proposal.provenanceSummary.provenance) {
    case 'system':
      return <Text dimColor>{label}</Text>;
    case 'user':
      return <Text color="yellow">{label}</Text>;
    case 'manual':
      return <Text color="cyan">{label}</Text>;
    case 'mixed':
      return <Text color="yellow">{label}</Text>;
  }
}

function countProposalLegs(proposals: TransferProposalWithTransactions[]): number {
  return proposals.reduce((total, proposal) => total + proposal.legs.length, 0);
}

function buildProposalProvenanceSummaryParts(
  proposals: readonly TransferProposalWithTransactions[],
  statusFilter?: LinkStatus
): string[] {
  const counts = countProposalProvenance(proposals);

  return [
    counts.user > 0 ? formatProposalKindCount('user', counts.user, statusFilter) : undefined,
    counts.manual > 0 ? formatProposalKindCount('manual', counts.manual, statusFilter) : undefined,
    counts.mixed > 0 ? formatProposalKindCount('mixed', counts.mixed, statusFilter) : undefined,
  ].filter((value): value is string => value !== undefined);
}

function buildFilteredProposalSummary(
  proposals: readonly TransferProposalWithTransactions[],
  statusFilter: LinkStatus,
  proposalCount: number,
  legCount: number
): string {
  const provenanceCounts = countProposalProvenance(proposals);
  const provenanceParts = [
    provenanceCounts.system > 0 ? `${provenanceCounts.system} system` : undefined,
    provenanceCounts.user > 0 ? `${provenanceCounts.user} user` : undefined,
    provenanceCounts.manual > 0 ? `${provenanceCounts.manual} manual` : undefined,
    provenanceCounts.mixed > 0 ? `${provenanceCounts.mixed} mixed` : undefined,
  ].filter((value): value is string => value !== undefined);

  return (
    `${proposalCount} ${statusFilter} proposal${proposalCount === 1 ? '' : 's'} ` +
    `(${legCount} leg${legCount === 1 ? '' : 's'}${provenanceParts.length > 0 ? `; ${provenanceParts.join(', ')}` : ''})`
  );
}

function countProposalProvenance(proposals: readonly TransferProposalWithTransactions[]): {
  manual: number;
  mixed: number;
  system: number;
  user: number;
} {
  return proposals.reduce(
    (acc, proposal) => {
      if (proposal.provenanceSummary.provenance === 'system') {
        acc.system += 1;
      } else if (proposal.provenanceSummary.provenance === 'user') {
        acc.user += 1;
      } else if (proposal.provenanceSummary.provenance === 'manual') {
        acc.manual += 1;
      } else if (proposal.provenanceSummary.provenance === 'mixed') {
        acc.mixed += 1;
      }

      return acc;
    },
    { manual: 0, mixed: 0, system: 0, user: 0 }
  );
}

function inferSingleStatusFilter(counts: LinksViewLinksState['counts']): LinkStatus | undefined {
  const statuses = (['confirmed', 'suggested', 'rejected'] as const).filter((status) => counts[status] > 0);
  return statuses.length === 1 ? statuses[0] : undefined;
}

function formatProposalKindCount(kind: 'manual' | 'mixed' | 'user', count: number, statusFilter?: LinkStatus): string {
  switch (kind) {
    case 'user':
      if (statusFilter === 'confirmed') {
        return `${count} user-confirmed proposal${count === 1 ? '' : 's'}`;
      }
      if (statusFilter === 'rejected') {
        return `${count} user-rejected proposal${count === 1 ? '' : 's'}`;
      }
      return `${count} user-reviewed proposal${count === 1 ? '' : 's'}`;
    case 'manual':
      return `${count} manual proposal${count === 1 ? '' : 's'}`;
    case 'mixed':
      return `${count} mixed-provenance proposal${count === 1 ? '' : 's'}`;
  }
}
