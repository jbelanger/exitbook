import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';
import type { LinkProposalBrowseItem } from '../links-browse-model.js';
import type { LinkGapBrowseItem } from '../links-gaps-browse-model.js';

import {
  formatCompactAmount,
  formatCoverage,
  formatGapRowTimestamp,
  formatLinkDate,
  formatLinkTypeDisplay,
  formatMatchCriteria,
  formatProposalConfidence,
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
const TRANSACTION_REF_COLUMN_LABEL = 'TX-REF';
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
    buildDetailLine('Route', formatProposalRoute(proposal)),
    buildDetailLine('Type', linkType),
    buildDetailLine('Confidence', colorizeText(confidenceColor, confidence.trim())),
    buildDetailLine('Matched', `${amountDisplay.matchedAmount} ${representativeLink.assetSymbol}`),
    buildDetailLine('Legs', `${proposal.legs.length}`),
    buildDetailLine('Match', formatMatchCriteria(representativeLink.matchCriteria)),
  ];

  if (amountDisplay.detailSummary) {
    lines.push(buildDetailLine(amountDisplay.detailLabel ?? 'Summary', amountDisplay.detailSummary));
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
    lines.push('All movements have confirmed counterparties.');
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(items, {
    ref: { format: (item) => item.transactionRef, minWidth: TRANSACTION_REF_COLUMN_LABEL.length },
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
          ref: TRANSACTION_REF_COLUMN_LABEL,
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
    `${pc.bold(`Link gap ${item.transactionRef}`)} ${pc.cyan(gapIssue.assetSymbol)} ${pc.yellow(
      `[${gapIssue.direction}]`
    )}`,
    '',
    buildDetailLine('Transaction ref', item.transactionRef),
    buildDetailLine('Transaction', `#${gapIssue.transactionId}`),
    buildDetailLine('Fingerprint', gapIssue.txFingerprint),
    ...(item.transactionGapCount > 1
      ? [
          buildDetailLine('Gap rows on tx', String(item.transactionGapCount)),
          buildDetailLine('Resolve scope', 'Transaction-wide'),
        ]
      : []),
    buildDetailLine('Platform', gapIssue.platformKey),
    ...(gapIssue.blockchainName && gapIssue.blockchainName !== gapIssue.platformKey
      ? [buildDetailLine('Blockchain', gapIssue.blockchainName)]
      : []),
    buildDetailLine('Date', gapIssue.timestamp),
    buildDetailLine('Operation', `${gapIssue.operationCategory}/${gapIssue.operationType}`),
    buildDetailLine('Missing', `${gapIssue.missingAmount} ${gapIssue.assetSymbol}`),
    buildDetailLine('Total', `${gapIssue.totalAmount} ${gapIssue.assetSymbol}`),
    buildDetailLine(
      'Coverage',
      colorizeText(getCoverageColor(coverageNum), `${gapIssue.confirmedCoveragePercent}% confirmed`)
    ),
    buildDetailLine('Readiness', colorizeText(getGapSuggestionColor(gapIssue), formatGapReadiness(item))),
    buildDetailLine('Explore', `exitbook links gaps explore ${item.transactionRef}`),
    buildDetailLine('Resolve', `exitbook links gaps resolve ${item.transactionRef}`),
    buildDetailLine('Next', nextStep),
  ];

  return `${lines.join('\n')}\n`;
}

function buildLinksListHeader(state: LinksViewLinksState, visibleCount: number): string {
  const title = state.statusFilter ? `Links (${state.statusFilter})` : 'Links';
  const displayedCount = state.proposals.length;
  const isFiltered = state.totalCount !== undefined && state.totalCount > displayedCount;
  const metadata = state.statusFilter
    ? [`${visibleCount} ${state.statusFilter}`]
    : [
        `${state.counts.confirmed} confirmed`,
        `${state.counts.suggested} suggested`,
        `${state.counts.rejected} rejected`,
      ].filter((value) => !value.startsWith('0 '));

  if (isFiltered) {
    metadata.push(`showing ${displayedCount} of ${state.totalCount}`);
  } else if (!state.statusFilter) {
    metadata.unshift(`${displayedCount} total`);
  }

  return `${pc.bold(title)}${metadata.length > 0 ? ` ${pc.dim(metadata.join(' · '))}` : ''}`;
}

function buildLinksEmptyStateLines(state: LinksViewLinksState): string[] {
  if (state.statusFilter) {
    return [`No ${state.statusFilter} proposals found.`];
  }

  return ['No link proposals found.', '', pc.dim('Tip: exitbook links run')];
}

function buildGapListHeader(state: LinksViewGapsState, visibleCount: number): string {
  const { linkAnalysis } = state;
  const readyToReview = linkAnalysis.issues.filter((issue) => issue.suggestedCount > 0).length;
  const needsInvestigation = linkAnalysis.summary.total_issues - readyToReview;
  const metadata = [
    `${visibleCount} shown`,
    ...(state.hiddenResolvedTransactionCount > 0
      ? [
          `${state.hiddenResolvedTransactionCount} resolved transaction${
            state.hiddenResolvedTransactionCount === 1 ? '' : 's'
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

function formatGapReadiness(item: LinkGapBrowseItem): string {
  if (item.gapIssue.suggestedCount === 0) {
    return 'manual review';
  }

  return `${item.gapIssue.suggestedCount} suggested${
    item.gapIssue.highestSuggestedConfidencePercent ? ` (${item.gapIssue.highestSuggestedConfidencePercent}%)` : ''
  }`;
}
