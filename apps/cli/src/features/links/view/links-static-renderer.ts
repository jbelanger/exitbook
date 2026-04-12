import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';
import type { LinkProposalBrowseItem } from '../links-browse-model.js';
import type { LinkGapBrowseItem } from '../links-gaps-browse-model.js';

import {
  formatCompactAmount,
  formatCoverage,
  formatGapCueLabel,
  formatGapRowTimestamp,
  formatLinkDate,
  formatLinkTypeDisplay,
  formatMatchCriteria,
  formatProposalConfidence,
  formatProposalProvenance,
  formatProposalProvenanceDetail,
  formatProposalRoute,
  getCoverageColor,
  getGapSuggestionColor,
  getProposalAmountDisplay,
  getProposalConfidenceColor,
  getStatusDisplay,
} from './links-view-formatters.js';
import type { LinksViewGapsState, LinksViewLinksState } from './links-view-state.js';

const STATIC_LIST_COLUMN_GAP = '  ';
const LINK_REF_COLUMN_LABEL = 'LINK-REF';
const GAP_REF_COLUMN_LABEL = 'GAP-REF';
const LINK_LIST_COLUMN_ORDER = ['ref', 'date', 'asset', 'status', 'route', 'confidence', 'legs'] as const;
const GAP_LIST_COLUMN_ORDER = [
  'ref',
  'date',
  'platform',
  'direction',
  'asset',
  'missing',
  'coverage',
  'readiness',
] as const;

export function outputLinksStaticList(state: LinksViewLinksState, items: LinkProposalBrowseItem[]): void {
  process.stdout.write(buildLinksStaticList(state, items));
}

export function buildLinksStaticList(state: LinksViewLinksState, items: LinkProposalBrowseItem[]): string {
  const lines: string[] = [buildLinksListHeader(state, items.length), ''];

  if (items.length === 0) {
    lines.push(...buildLinksEmptyStateLines(state));
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(items, {
    ref: { format: (item) => item.proposalRef, minWidth: LINK_REF_COLUMN_LABEL.length },
    date: {
      format: (item) => formatLinkDate(item.proposal.representativeLeg),
      minWidth: 'DATE'.length,
    },
    asset: {
      format: (item) => item.proposal.representativeLink.assetSymbol,
      minWidth: 'ASSET'.length,
    },
    status: {
      format: (item) => item.proposal.status,
      minWidth: 'STATUS'.length,
    },
    route: {
      format: (item) => formatProposalRoute(item.proposal),
      minWidth: 'ROUTE'.length,
    },
    confidence: {
      align: 'right',
      format: (item) => formatProposalConfidence(item.proposal),
      minWidth: 'CONF'.length,
    },
    legs: {
      align: 'right',
      format: (item) => `${item.proposal.legs.length}`,
      minWidth: 'LEGS'.length,
    },
  });

  lines.push(
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          ref: LINK_REF_COLUMN_LABEL,
          date: 'DATE',
          asset: 'ASSET',
          status: 'STATUS',
          route: 'ROUTE',
          confidence: 'CONF',
          legs: 'LEGS',
        },
        LINK_LIST_COLUMN_ORDER,
        { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
      )
    )
  );

  for (const item of items) {
    const formatted = columns.format(item);
    const statusDisplay = getStatusDisplay(item.proposal.status);

    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          ref: pc.bold(formatted.ref),
          date: pc.dim(formatted.date),
          asset: pc.cyan(formatted.asset),
          status: colorizeStatus(statusDisplay.iconColor, formatted.status),
          route: pc.dim(formatted.route),
          confidence: colorizeConfidence(item, formatted.confidence),
          legs: pc.dim(formatted.legs),
        },
        LINK_LIST_COLUMN_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return `${lines.join('\n')}\n`;
}

export function outputLinkProposalStaticDetail(item: LinkProposalBrowseItem, verbose: boolean): void {
  process.stdout.write(buildLinkProposalStaticDetail(item, verbose));
}

export function buildLinkProposalStaticDetail(item: LinkProposalBrowseItem, verbose: boolean): string {
  const { proposal } = item;
  const representativeLeg = proposal.representativeLeg;
  const representativeLink = proposal.representativeLink;
  const linkType = formatLinkTypeDisplay(
    representativeLink,
    representativeLeg.sourceTransaction,
    representativeLeg.targetTransaction
  );
  const confidence = formatProposalConfidence(proposal);
  const confidenceColor = getProposalConfidenceColor(proposal);
  const amountDisplay = getProposalAmountDisplay(proposal);
  const statusDisplay = getStatusDisplay(proposal.status);

  const lines: string[] = [
    `${pc.bold(`Link proposal ${item.proposalRef}`)} ${pc.cyan(representativeLink.assetSymbol)} ${colorizeStatus(
      statusDisplay.iconColor,
      `[${proposal.status}]`
    )}`,
    '',
    buildDetailLine('Link ref', item.proposalRef),
    buildDetailLine('Status', colorizeStatus(statusDisplay.iconColor, proposal.status)),
    buildDetailLine(
      'Provenance',
      colorizeProvenance(proposal.provenanceSummary.provenance, formatProposalProvenance(proposal.provenanceSummary))
    ),
    buildDetailLine('Route', formatProposalRoute(proposal)),
    buildDetailLine('Type', linkType),
    buildDetailLine('Confidence', colorizeText(confidenceColor, confidence.trim())),
    buildDetailLine('Linked amount', `${amountDisplay.linkedAmount} ${representativeLink.assetSymbol}`),
    buildDetailLine('Legs', `${proposal.legs.length}`),
    buildDetailLine('Match', formatMatchCriteria(representativeLink.matchCriteria)),
  ];

  if (amountDisplay.detailSummary) {
    lines.push(buildDetailLine(amountDisplay.detailLabel ?? 'Summary', amountDisplay.detailSummary));
  }

  const provenanceDetail = formatProposalProvenanceDetail(proposal.provenanceSummary);
  if (provenanceDetail) {
    lines.push(buildDetailLine('Provenance detail', provenanceDetail));
  }

  lines.push('', pc.dim(`Legs (${proposal.legs.length})`));
  for (const leg of proposal.legs) {
    lines.push(buildProposalLegLine(leg));

    if (verbose) {
      if (leg.sourceTransaction?.from) {
        lines.push(`    ${pc.dim('from:')} ${leg.sourceTransaction.from}`);
      }
      if (leg.targetTransaction?.to) {
        lines.push(`    ${pc.dim('to:')} ${leg.targetTransaction.to}`);
      }
    }
  }

  lines.push('', buildDetailLine('Explore', `exitbook links explore ${item.proposalRef}`));

  if (proposal.status === 'suggested') {
    lines.push(buildDetailLine('Confirm', `exitbook links confirm ${item.proposalRef}`));
    lines.push(buildDetailLine('Reject', `exitbook links reject ${item.proposalRef}`));
  }

  return `${lines.join('\n')}\n`;
}

export function outputLinkGapsStaticList(state: LinksViewGapsState, items: LinkGapBrowseItem[]): void {
  process.stdout.write(buildLinkGapsStaticList(state, items));
}

export function buildLinkGapsStaticList(state: LinksViewGapsState, items: LinkGapBrowseItem[]): string {
  const lines: string[] = [buildGapListHeader(state, items.length), ''];

  if (items.length === 0) {
    lines.push(...buildLinkGapsEmptyStateLines(state));
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(items, {
    ref: { format: (item) => item.gapRef, minWidth: GAP_REF_COLUMN_LABEL.length },
    date: {
      format: (item) => formatGapRowTimestamp(item.gapIssue.timestamp),
      minWidth: 'DATE'.length,
    },
    platform: {
      format: (item) => item.gapIssue.platformKey,
      minWidth: 'PLATFORM'.length,
    },
    direction: {
      format: (item) => (item.gapIssue.direction === 'inflow' ? 'IN' : 'OUT'),
      minWidth: 'DIR'.length,
    },
    asset: {
      format: (item) => item.gapIssue.assetSymbol,
      minWidth: 'ASSET'.length,
    },
    missing: {
      align: 'right',
      format: (item) => formatCompactAmount(item.gapIssue.missingAmount),
      minWidth: 'MISSING'.length,
    },
    coverage: {
      align: 'right',
      format: (item) => formatCoverage(item.gapIssue.confirmedCoveragePercent),
      minWidth: 'COVERAGE'.length,
    },
    readiness: {
      format: (item) => formatGapReadiness(item),
      minWidth: 'READINESS'.length,
    },
  });

  lines.push(
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          ref: GAP_REF_COLUMN_LABEL,
          date: 'DATE',
          platform: 'PLATFORM',
          direction: 'DIR',
          asset: 'ASSET',
          missing: 'MISSING',
          coverage: 'COVERAGE',
          readiness: 'READINESS',
        },
        GAP_LIST_COLUMN_ORDER,
        { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
      )
    )
  );

  for (const item of items) {
    const formatted = columns.format(item);
    const coverage = parseFloat(item.gapIssue.confirmedCoveragePercent);

    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          ref: pc.bold(formatted.ref),
          date: pc.dim(formatted.date),
          platform: pc.cyan(formatted.platform),
          direction:
            item.gapIssue.direction === 'inflow' ? pc.green(formatted.direction) : pc.yellow(formatted.direction),
          asset: pc.cyan(formatted.asset),
          missing: pc.green(formatted.missing),
          coverage: colorizeText(getCoverageColor(coverage), formatted.coverage),
          readiness: colorizeText(getGapSuggestionColor(item.gapIssue), formatted.readiness),
        },
        GAP_LIST_COLUMN_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return `${lines.join('\n')}\n`;
}

export function outputLinkGapStaticDetail(item: LinkGapBrowseItem): void {
  process.stdout.write(buildLinkGapStaticDetail(item));
}

export function buildLinkGapStaticDetail(item: LinkGapBrowseItem): string {
  const { gapIssue } = item;
  const coverageNum = parseFloat(gapIssue.confirmedCoveragePercent);
  const nextStep = gapIssue.suggestedCount > 0 ? 'exitbook links explore --status suggested' : 'exitbook links run';

  const lines = [
    `${pc.bold(`Link gap ${item.gapRef}`)} ${pc.cyan(gapIssue.assetSymbol)} ${pc.yellow(`[${gapIssue.direction}]`)}`,
    '',
    buildDetailLine('Gap ref', item.gapRef),
    buildDetailLine('Transaction ref', item.transactionRef),
    buildDetailLine('Transaction', `#${gapIssue.transactionId}`),
    buildDetailLine('Fingerprint', gapIssue.txFingerprint),
    ...(item.transactionGapCount > 1 ? [buildDetailLine('Open gap rows on tx', String(item.transactionGapCount))] : []),
    buildDetailLine('Platform', gapIssue.platformKey),
    ...(gapIssue.blockchainName && gapIssue.blockchainName !== gapIssue.platformKey
      ? [buildDetailLine('Blockchain', gapIssue.blockchainName)]
      : []),
    buildDetailLine('Date', gapIssue.timestamp),
    buildDetailLine('Operation', `${gapIssue.operationCategory}/${gapIssue.operationType}`),
    buildDetailLine('Asset ID', gapIssue.assetId),
    buildDetailLine('Missing', `${gapIssue.missingAmount} ${gapIssue.assetSymbol}`),
    buildDetailLine('Total', `${gapIssue.totalAmount} ${gapIssue.assetSymbol}`),
    buildDetailLine(
      'Coverage',
      colorizeText(getCoverageColor(coverageNum), `${gapIssue.confirmedCoveragePercent}% confirmed`)
    ),
    buildDetailLine('Readiness', colorizeText(getGapSuggestionColor(gapIssue), formatGapReadiness(item))),
    ...(gapIssue.gapCue ? [buildDetailLine('Cue', colorizeText('cyan', formatGapCueLabel(gapIssue.gapCue)))] : []),
    ...(gapIssue.contextHint ? [buildDetailLine('Context', colorizeText('yellow', gapIssue.contextHint.message))] : []),
    buildDetailLine('Explore', `exitbook links gaps explore ${item.gapRef}`),
    buildDetailLine('Resolve', `exitbook links gaps resolve ${item.gapRef}`),
    buildDetailLine('Next', nextStep),
  ];

  return `${lines.join('\n')}\n`;
}

function buildLinksListHeader(state: LinksViewLinksState, visibleCount: number): string {
  const title = state.statusFilter ? `Link Proposals (${state.statusFilter})` : 'Link Proposals';
  const displayedCount = visibleCount;
  const displayedLinkCount = state.proposals.reduce((total, proposal) => total + proposal.legs.length, 0);
  const provenanceSummaryParts = buildProposalProvenanceSummaryParts(state.proposals, state.statusFilter);
  const effectiveStatusFilter = state.statusFilter ?? inferSingleStatusFilter(state.counts);
  const summaryStatus = state.statusFilter ?? effectiveStatusFilter;
  const filteredSummary =
    summaryStatus !== undefined
      ? buildFilteredProposalSummary(state.proposals, summaryStatus, displayedCount, displayedLinkCount)
      : undefined;
  const isFiltered = state.totalCount !== undefined && state.totalCount > displayedCount;
  const metadata = [
    ...(filteredSummary
      ? [filteredSummary]
      : [
          `${displayedCount} proposal${displayedCount === 1 ? '' : 's'}`,
          `${displayedLinkCount} link${displayedLinkCount === 1 ? '' : 's'}`,
          ...provenanceSummaryParts,
        ]),
    ...(summaryStatus === undefined
      ? [
          `${state.counts.confirmed} confirmed`,
          `${state.counts.suggested} suggested`,
          `${state.counts.rejected} rejected`,
        ].filter((value) => !value.startsWith('0 '))
      : []),
  ];

  if (isFiltered) {
    metadata.push(`showing ${displayedCount} of ${state.totalCount} proposals`);
  }

  return `${pc.bold(title)}${metadata.length > 0 ? ` ${pc.dim(metadata.join(' · '))}` : ''}`;
}

function inferSingleStatusFilter(counts: LinksViewLinksState['counts']): LinksViewLinksState['statusFilter'] {
  const statuses = (['confirmed', 'suggested', 'rejected'] as const).filter((status) => counts[status] > 0);
  return statuses.length === 1 ? statuses[0] : undefined;
}

function buildLinksEmptyStateLines(state: LinksViewLinksState): string[] {
  if (state.statusFilter) {
    return [`No ${state.statusFilter} proposals found.`];
  }

  return ['No link proposals found.', '', pc.dim('Tip: exitbook links run')];
}

function buildLinkGapsEmptyStateLines(state: LinksViewGapsState): string[] {
  if (state.hiddenResolvedIssueCount > 0) {
    return [
      `No open gaps. ${state.hiddenResolvedIssueCount} gap${
        state.hiddenResolvedIssueCount === 1 ? ' is' : 's are'
      } hidden by resolution overrides.`,
    ];
  }

  return ['All movements have confirmed counterparties.'];
}

function buildGapListHeader(state: LinksViewGapsState, visibleCount: number): string {
  const { linkAnalysis } = state;
  const readyToReview = linkAnalysis.issues.filter((issue) => issue.suggestedCount > 0).length;
  const needsInvestigation = linkAnalysis.summary.total_issues - readyToReview;
  const metadata = [
    `${visibleCount} shown`,
    ...(state.hiddenResolvedIssueCount > 0
      ? [
          `${state.hiddenResolvedIssueCount} override-resolved gap${
            state.hiddenResolvedIssueCount === 1 ? '' : 's'
          } hidden`,
        ]
      : []),
    `${linkAnalysis.summary.uncovered_inflows} uncovered inflow${
      linkAnalysis.summary.uncovered_inflows === 1 ? '' : 's'
    }`,
    `${linkAnalysis.summary.unmatched_outflows} unmatched outflow${
      linkAnalysis.summary.unmatched_outflows === 1 ? '' : 's'
    }`,
    `${readyToReview} ready to review`,
    `${needsInvestigation} manual review`,
  ];

  return `${pc.bold('Link Gaps')} ${pc.dim(metadata.join(' · '))}`;
}

function buildDetailLine(label: string, value: string): string {
  return `${pc.dim(`${label}:`)} ${value}`;
}

function buildProposalLegLine(item: LinkProposalBrowseItem['proposal']['legs'][number]): string {
  const sourcePlatform = item.sourceTransaction?.platformKey ?? 'unknown';
  const targetPlatform = item.targetTransaction?.platformKey ?? 'unknown';
  const sourceTime = item.sourceTransaction?.datetime ?? '?';
  const targetTime = item.targetTransaction?.datetime ?? '?';

  return (
    `  #${item.link.id} ${pc.cyan(sourcePlatform)} ${pc.dim(sourceTime)} ${pc.yellow('OUT')} ` +
    `${pc.green(item.link.sourceAmount.toFixed())} ${item.link.assetSymbol} ${pc.dim('→')} ` +
    `${pc.cyan(targetPlatform)} ${pc.dim(targetTime)} ${pc.green('IN')} ` +
    `${pc.green(item.link.targetAmount.toFixed())} ${item.link.assetSymbol}`
  );
}

function colorizeStatus(color: string, value: string): string {
  switch (color) {
    case 'green':
      return pc.green(value);
    case 'yellow':
      return pc.yellow(value);
    case 'dim':
      return pc.dim(value);
    case 'red':
      return pc.red(value);
    default:
      return value;
  }
}

function colorizeText(color: string, value: string): string {
  switch (color) {
    case 'green':
      return pc.green(value);
    case 'yellow':
      return pc.yellow(value);
    case 'red':
      return pc.red(value);
    case 'dim':
      return pc.dim(value);
    case 'cyan':
      return pc.cyan(value);
    default:
      return value;
  }
}

function colorizeConfidence(item: LinkProposalBrowseItem, value: string): string {
  return colorizeText(getProposalConfidenceColor(item.proposal), value);
}

function colorizeProvenance(provenance: 'manual' | 'mixed' | 'system' | 'user', value: string): string {
  switch (provenance) {
    case 'system':
      return pc.dim(value);
    case 'user':
      return pc.yellow(value);
    case 'manual':
      return pc.cyan(value);
    case 'mixed':
      return pc.yellow(value);
  }
}

function buildProposalProvenanceSummaryParts(
  proposals: LinksViewLinksState['proposals'],
  statusFilter?: LinksViewLinksState['statusFilter']
): string[] {
  const counts = countProposalProvenance(proposals);

  return [
    counts.user > 0 ? formatProposalKindCount('user', counts.user, statusFilter) : undefined,
    counts.manual > 0 ? formatProposalKindCount('manual', counts.manual, statusFilter) : undefined,
    counts.mixed > 0 ? formatProposalKindCount('mixed', counts.mixed, statusFilter) : undefined,
  ].filter((value): value is string => value !== undefined);
}

function buildFilteredProposalSummary(
  proposals: LinksViewLinksState['proposals'],
  statusFilter: NonNullable<LinksViewLinksState['statusFilter']>,
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

function countProposalProvenance(proposals: readonly LinksViewLinksState['proposals'][number][]): {
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

function formatProposalKindCount(
  kind: 'manual' | 'mixed' | 'user',
  count: number,
  statusFilter?: LinksViewLinksState['statusFilter']
): string {
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

function formatGapReadiness(item: LinkGapBrowseItem): string {
  const readiness =
    item.gapIssue.suggestedCount === 0
      ? 'manual review'
      : `${item.gapIssue.suggestedCount} suggested${
          item.gapIssue.highestSuggestedConfidencePercent
            ? ` (${item.gapIssue.highestSuggestedConfidencePercent}%)`
            : ''
        }`;

  const cueSuffix = item.gapIssue.gapCue ? ` · ${formatGapCueLabel(item.gapIssue.gapCue)}` : '';
  const contextSuffix = item.gapIssue.contextHint ? ` · ${item.gapIssue.contextHint.label}` : '';

  return `${readiness}${cueSuffix}${contextSuffix}`;
}
