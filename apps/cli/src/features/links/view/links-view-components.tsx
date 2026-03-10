/**
 * Links view TUI components
 */

import {
  hasImpliedFeeLinkMetadata,
  isPartialMatchLinkMetadata,
  isSameHashExternalLinkMetadata,
  type LinkStatus,
  type MatchCriteria,
  type TransactionLink,
} from '@exitbook/accounting';
import { Decimal } from 'decimal.js';
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
import type { LinkGapAssetSummary, LinkGapIssue } from '../command/links-gap-utils.js';

import { handleKeyboardInput, linksViewReducer } from './links-view-controller.js';
import {
  GAP_DETAIL_LINES,
  GAP_TOP_ASSET_LIMIT,
  getGapsChromeLines,
  LINK_DETAIL_LINES,
  LINKS_CHROME_LINES,
} from './links-view-layout.js';
import type {
  LinkWithTransactions,
  TransferProposalWithTransactions,
  LinksViewGapsState,
  LinksViewLinksState,
  LinksViewState,
} from './links-view-state.js';
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
  ) => Promise<{ affectedLinkIds: number[]; newStatus: 'confirmed' | 'rejected' }>;
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
    handleKeyboardInput(
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

      void onAction(linkId, action)
        .then((result) => {
          dispatch({
            type: 'ACTION_SUCCESS',
            affectedLinkIds: result.affectedLinkIds,
            newStatus: result.newStatus,
          });
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
        <Text dimColor>{legCountSuffix}</Text> {confidence} {status}
      </SelectableRow>
    );
  }

  return (
    <SelectableRow isSelected={isSelected}>
      <Text color={iconColor}>{icon}</Text> {date} {asset} {renderAmountSummary(amountDisplay)}{' '}
      <Text color="cyan">{sourceTarget}</Text>
      <Text dimColor>{legCountSuffix}</Text> {confidence} {status}
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
  const linkType = formatLinkTypeDisplay(link, sourceTransaction, targetTransaction);
  const confidence = formatConfidenceScore(link.confidenceScore.toNumber());
  const confidenceColor = getConfidenceColor(link.confidenceScore.toNumber());
  const { iconColor: statusColor } = getStatusDisplay(proposal.status);
  const amountDisplay = getProposalAmountDisplay(proposal);
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {link.id}</Text> {link.assetSymbol} <Text dimColor>{linkType}</Text>{' '}
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
    <Text key="match">
      {'  '}
      <Text dimColor>Match: </Text>
      {formatMatchCriteria(link.matchCriteria)}
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

  return rows;
}

function buildMultiLegDetailRows(proposal: TransferProposalWithTransactions): ReactElement[] {
  const representativeLeg = proposal.representativeLeg;
  const representativeLink = representativeLeg.link;
  const confidence = formatProposalConfidence(proposal);
  const confidenceColor = getProposalConfidenceColor(proposal);
  const { iconColor: statusColor } = getStatusDisplay(proposal.status);
  const amountDisplay = getProposalAmountDisplay(proposal);
  const visibleLegs = proposal.legs.slice(0, MAX_MULTI_LEG_DETAIL_ROWS);
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {representativeLink.id}</Text> {representativeLink.assetSymbol}{' '}
      <Text dimColor>transfer proposal</Text> <Text color={confidenceColor}>{confidence}</Text>{' '}
      <Text color={statusColor}>{proposal.status}</Text>
    </Text>,
    <Text key="blank-1"> </Text>,
    <Text key="scope">
      {'  '}
      <Text dimColor>Scope: </Text>
      {proposal.legs.length} legs review together <Text dimColor>(</Text>
      {proposal.legs.map((leg) => leg.link.id).join(', ')}
      <Text dimColor>)</Text>
    </Text>,
    ...visibleLegs.map((leg, index) => (
      <Text key={`leg-${leg.link.id}`}>
        {'  '}
        <Text dimColor>Leg {index + 1}: </Text>#{leg.link.id}{' '}
        <Text color="cyan">{leg.sourceTransaction?.source ?? 'unknown'}</Text>{' '}
        <Text dimColor>{leg.sourceTransaction?.datetime ?? '?'}</Text> <Text color="yellow">OUT</Text>{' '}
        <Text color="green">{leg.link.sourceAmount.toFixed()}</Text> {leg.link.assetSymbol} <Text dimColor>→</Text>{' '}
        <Text color="cyan">{leg.targetTransaction?.source ?? 'unknown'}</Text>{' '}
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

  return rows;
}

interface LinkAmountDisplay {
  detailLabel?: string | undefined;
  detailSummary?: string | undefined;
  matchedAmount: string;
}

function getProposalAmountDisplay(proposal: TransferProposalWithTransactions): LinkAmountDisplay {
  const link = proposal.representativeLink;
  const metadata = link.metadata;

  if (proposal.legs.length > 1) {
    const totalMatchedAmount = proposal.legs.reduce((sum, leg) => sum.plus(leg.link.sourceAmount), new Decimal(0));
    const sameHashSummary =
      isSameHashExternalLinkMetadata(metadata) &&
      metadata.sameHashMixedExternalGroup === true &&
      typeof metadata.sameHashTrackedSiblingInflowAmount === 'string' &&
      typeof metadata.sameHashTrackedSiblingInflowCount === 'number'
        ? `same-hash mixed group: ${metadata.sameHashExternalGroupAmount} ${link.assetSymbol} to exchange ` +
          `after ${metadata.sameHashTrackedSiblingInflowAmount} ${link.assetSymbol} to ` +
          `${metadata.sameHashTrackedSiblingInflowCount} ${
            metadata.sameHashTrackedSiblingInflowCount === 1 ? 'tracked sibling inflow' : 'tracked sibling inflows'
          }`
        : undefined;

    return {
      detailLabel: 'Summary:',
      matchedAmount: totalMatchedAmount.toFixed(),
      detailSummary: sameHashSummary ?? `${proposal.legs.length} linked legs between ${formatProposalRoute(proposal)}`,
    };
  }

  if (
    isSameHashExternalLinkMetadata(metadata) &&
    metadata.sameHashMixedExternalGroup === true &&
    typeof metadata.sameHashTrackedSiblingInflowAmount === 'string' &&
    typeof metadata.sameHashTrackedSiblingInflowCount === 'number'
  ) {
    const siblingLabel =
      metadata.sameHashTrackedSiblingInflowCount === 1 ? 'tracked sibling inflow' : 'tracked sibling inflows';

    return {
      detailLabel: 'Summary:',
      matchedAmount: link.sourceAmount.toFixed(),
      detailSummary:
        `same-hash mixed group: ${metadata.sameHashExternalGroupAmount} ${link.assetSymbol} to exchange ` +
        `after ${metadata.sameHashTrackedSiblingInflowAmount} ${link.assetSymbol} to ` +
        `${metadata.sameHashTrackedSiblingInflowCount} ${siblingLabel}`,
    };
  }

  if (isPartialMatchLinkMetadata(metadata)) {
    const consumedAmount = metadata.consumedAmount ?? link.sourceAmount.toFixed();
    const fullSourceAmount = metadata.fullSourceAmount ?? link.sourceAmount.toFixed();
    const fullTargetAmount = metadata.fullTargetAmount ?? link.targetAmount.toFixed();

    return {
      detailLabel: 'Summary:',
      matchedAmount: consumedAmount,
      detailSummary: `split match between ${fullSourceAmount} ${link.assetSymbol} sent and ${fullTargetAmount} ${link.assetSymbol} received`,
    };
  }

  if (link.sourceAmount.equals(link.targetAmount)) {
    return {
      matchedAmount: link.sourceAmount.toFixed(),
      detailSummary: undefined,
    };
  }

  if (link.sourceAmount.greaterThan(link.targetAmount)) {
    return {
      detailLabel: hasImpliedFeeLinkMetadata(metadata) ? 'Implied fee:' : 'Change:',
      matchedAmount: link.targetAmount.toFixed(),
      detailSummary: `${hasImpliedFeeLinkMetadata(metadata) ? metadata.impliedFee : link.sourceAmount.minus(link.targetAmount).toFixed()} ${link.assetSymbol}`,
    };
  }

  return {
    detailLabel: 'Difference:',
    matchedAmount: link.sourceAmount.toFixed(),
    detailSummary: `target exceeds source by ${link.targetAmount.minus(link.sourceAmount).toFixed()} ${link.assetSymbol}`,
  };
}

function formatLinkTypeDisplay(
  link: TransactionLink,
  sourceTransaction: LinkWithTransactions['sourceTransaction'],
  targetTransaction: LinkWithTransactions['targetTransaction']
): string {
  if (sourceTransaction?.sourceType === 'blockchain' && targetTransaction?.sourceType === 'exchange') {
    return 'blockchain to exchange';
  }

  if (sourceTransaction?.sourceType === 'exchange' && targetTransaction?.sourceType === 'blockchain') {
    return 'exchange to blockchain';
  }

  if (sourceTransaction?.sourceType === 'blockchain' && targetTransaction?.sourceType === 'blockchain') {
    return link.linkType === 'blockchain_internal' ? 'blockchain internal' : 'blockchain to blockchain';
  }

  if (sourceTransaction?.sourceType === 'exchange' && targetTransaction?.sourceType === 'exchange') {
    return 'exchange to exchange';
  }

  return link.linkType.replace(/_/g, ' ');
}

function formatProposalRoute(proposal: TransferProposalWithTransactions): string {
  const sourceNames = uniqueNonEmptyValues(proposal.legs.map((leg) => leg.sourceTransaction?.source ?? 'unknown'));
  const targetNames = uniqueNonEmptyValues(proposal.legs.map((leg) => leg.targetTransaction?.source ?? 'unknown'));

  return `${formatProposalEndpoint(sourceNames)} → ${formatProposalEndpoint(targetNames)}`;
}

function formatProposalEndpoint(names: string[]): string {
  if (names.length === 0) {
    return 'unknown';
  }

  if (names.length === 1) {
    return names[0]!;
  }

  return `${names[0]!} +${names.length - 1}`;
}

function uniqueNonEmptyValues(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function formatProposalConfidence(proposal: TransferProposalWithTransactions): string {
  const confidenceValues = proposal.legs.map((leg) => leg.link.confidenceScore.toNumber());
  const min = Math.min(...confidenceValues);
  const max = Math.max(...confidenceValues);

  if (Math.abs(max - min) < 0.000001) {
    return formatConfidenceScore(max);
  }

  return `${(min * 100).toFixed(1)}-${(max * 100).toFixed(1)}%`;
}

function getProposalConfidenceColor(proposal: TransferProposalWithTransactions): string {
  const confidenceValues = proposal.legs.map((leg) => leg.link.confidenceScore.toNumber());
  return getConfidenceColor(Math.min(...confidenceValues));
}

function renderAmountSummary(display: LinkAmountDisplay) {
  return (
    <>
      <Text color="green">{formatAmount(display.matchedAmount, 15)}</Text> <Text dimColor>matched</Text>
    </>
  );
}

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
  const readyToReview = state.linkAnalysis.issues.filter((issue) => issue.suggestedCount > 0).length;
  const needsInvestigation = summary.total_issues - readyToReview;

  return (
    <Box flexDirection="column">
      <Text bold>Transaction Links (gaps)</Text>
      <Text>
        <Text color="yellow">{summary.total_issues} gaps</Text>
        <Text dimColor> · </Text>
        <Text color={summary.uncovered_inflows > 0 ? 'green' : 'dim'}>
          {summary.uncovered_inflows} uncovered inflow{summary.uncovered_inflows !== 1 ? 's' : ''}
        </Text>
        <Text dimColor> · </Text>
        <Text color={summary.unmatched_outflows > 0 ? 'yellow' : 'dim'}>
          {summary.unmatched_outflows} unmatched outflow{summary.unmatched_outflows !== 1 ? 's' : ''}
        </Text>
        <Text dimColor> · </Text>
        <Text color={readyToReview > 0 ? 'green' : 'dim'}>{readyToReview} ready to review</Text>
        <Text dimColor> · </Text>
        <Text color={needsInvestigation > 0 ? 'yellow' : 'dim'}>{needsInvestigation} manual review</Text>
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

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function formatCompactAmount(amount: string): string {
  const num = Number.parseFloat(amount);
  if (Number.isNaN(num)) {
    return amount;
  }

  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });

  if (formatted === '0' && num !== 0) {
    return num.toExponential(2);
  }

  return formatted;
}

function formatGapRowTimestamp(timestamp: string): string {
  return timestamp.substring(0, 16).replace('T', ' ');
}

function getGapSuggestionColor(issue: LinkGapIssue): string {
  if (issue.suggestedCount === 0) {
    return 'yellow';
  }

  return issue.highestSuggestedConfidencePercent
    ? getConfidenceColor(parseFloat(issue.highestSuggestedConfidencePercent) / 100)
    : 'green';
}

function renderGapSuggestionSummary(issue: LinkGapIssue): ReactElement {
  if (issue.suggestedCount === 0) {
    return <Text color="yellow">manual review</Text>;
  }

  return (
    <Text color={getGapSuggestionColor(issue)}>
      {issue.suggestedCount} suggestion{issue.suggestedCount !== 1 ? 's' : ''}
      {issue.highestSuggestedConfidencePercent ? ` (${issue.highestSuggestedConfidencePercent}%)` : ''}
    </Text>
  );
}

/**
 * Gap list component with scrolling support
 */
const GapList: FC<{ state: LinksViewGapsState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { linkAnalysis, selectedIndex, scrollOffset } = state;
  const issues = linkAnalysis.issues;

  const visibleRows = calculateVisibleRows(terminalHeight, getGapsChromeLines(linkAnalysis.summary.assets.length));

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
const GapRow: FC<{
  isSelected: boolean;
  issue: LinkGapIssue;
}> = ({ issue, isSelected }) => {
  const source = issue.blockchain ?? issue.source;
  const timestamp = formatGapRowTimestamp(issue.timestamp);
  const dir = issue.direction === 'inflow' ? 'IN ' : 'OUT';
  const dirColor = issue.direction === 'inflow' ? 'green' : 'yellow';
  const coverage = parseFloat(issue.confirmedCoveragePercent);
  const hasPartialCoverage = coverage > 0 && coverage < 100;

  return (
    <SelectableRow isSelected={isSelected}>
      <Text color="yellow">⚠</Text> #{issue.transactionId} <Text color="cyan">{source}</Text>{' '}
      <Text dimColor>{timestamp}</Text> <Text color={dirColor}>{dir}</Text>{' '}
      <Text color="green">{formatCompactAmount(issue.missingAmount)}</Text>{' '}
      {truncateText(issue.assetSymbol, GAP_ROW_ASSET_SYMBOL_MAX_WIDTH)} <Text dimColor>missing</Text>
      {hasPartialCoverage && (
        <>
          <Text dimColor> · </Text>
          <Text color={getCoverageColor(coverage)}>{formatCoverage(issue.confirmedCoveragePercent)}</Text>
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
  const issue = state.linkAnalysis.issues[state.selectedIndex];

  if (!issue) {
    return null;
  }

  return (
    <FixedHeightDetail
      height={GAP_DETAIL_LINES}
      rows={buildGapDetailRows(issue)}
    />
  );
};

function buildGapDetailRows(issue: LinkGapIssue): ReactElement[] {
  const txId = `#${issue.transactionId}`;
  const source = issue.blockchain ?? issue.source;
  const operation = `${issue.operationCategory}/${issue.operationType}`;
  const directionLabel = issue.direction === 'inflow' ? 'inflow' : 'outflow';
  const coverageNum = parseFloat(issue.confirmedCoveragePercent);
  const coverageColor = getCoverageColor(coverageNum);

  const actionText =
    issue.direction === 'inflow'
      ? 'Run `exitbook links run` then confirm matches to bridge this gap.'
      : 'This may be treated as a gift; identify the destination wallet or confirm a link.';

  return [
    <Text key="title">
      <Text bold>▸ {txId}</Text> <Text color="cyan">{source}</Text> <Text dimColor>{operation}</Text>{' '}
      <Text dimColor>{issue.timestamp}</Text>
    </Text>,
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
    <Text key="external">
      {'  '}
      <Text dimColor>External: </Text>
      {issue.externalId}
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
          switch to <Text dimColor>`exitbook links view --status suggested`</Text> after refreshing links
        </Text>
      ) : (
        <Text>
          capture the counterparty first, then re-run <Text dimColor>`exitbook links run`</Text>
        </Text>
      )}
    </Text>,
  ];
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

function formatLinkDate(item: LinkWithTransactions): string {
  const rawTimestamp =
    item.sourceTransaction?.datetime ?? item.targetTransaction?.datetime ?? item.link.createdAt.toISOString();
  const parsed = new Date(rawTimestamp);

  if (Number.isNaN(parsed.getTime())) {
    return 'unknown'.padEnd(10);
  }

  return parsed.toISOString().slice(0, 10);
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

  // For hash matches, emphasize that over amount similarity
  if (criteria.hashMatch === true) {
    parts.push('hash');
  }

  if (criteria.assetMatch) {
    parts.push('asset');
  }

  // For hash matches with perfect similarity, show differently to avoid confusion
  const amountSimilarity =
    typeof criteria.amountSimilarity === 'string'
      ? parseFloat(criteria.amountSimilarity)
      : criteria.amountSimilarity.toNumber();

  if (criteria.hashMatch === true && amountSimilarity === 1.0) {
    // Don't show "amount 100%" for hash matches - it's misleading for UTXO transactions
    // The hash match already validates the connection
  } else {
    parts.push(`amount ${(amountSimilarity * 100).toFixed(1)}%`);
  }

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
