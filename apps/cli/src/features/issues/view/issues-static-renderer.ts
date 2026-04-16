import type {
  AccountingIssueDetailItem,
  AccountingIssueEvidenceRef,
  AccountingIssueNextAction,
  AccountingIssueScopeSummary,
  AccountingIssueSummaryItem,
} from '@exitbook/accounting/issues';
import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';

const STATIC_LIST_COLUMN_GAP = '  ';
const ISSUE_LIST_COLUMN_ORDER = ['ref', 'severity', 'review', 'type', 'summary', 'next'] as const;
const SCOPED_LENS_COLUMN_ORDER = ['scope', 'status', 'open', 'updated', 'next'] as const;

export interface IssuesStaticOverviewState {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
  currentIssues: AccountingIssueSummaryItem[];
  profileDisplayName: string;
  scope: AccountingIssueScopeSummary;
  scopedLenses: AccountingIssueScopeSummary[];
}

export interface IssuesStaticDetailState {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
  issue: AccountingIssueDetailItem;
  profileDisplayName: string;
}

export interface IssuesStaticScopedListState {
  activeProfileKey: string;
  activeProfileSource: 'default' | 'env' | 'state';
  currentIssues: AccountingIssueSummaryItem[];
  profileDisplayName: string;
  scope: AccountingIssueScopeSummary;
}

export function outputIssuesStaticOverview(state: IssuesStaticOverviewState): void {
  process.stdout.write(buildIssuesStaticOverview(state));
}

export function outputIssuesStaticDetail(state: IssuesStaticDetailState): void {
  process.stdout.write(buildIssuesStaticDetail(state));
}

export function outputIssuesStaticScopedList(state: IssuesStaticScopedListState): void {
  process.stdout.write(buildIssuesStaticScopedList(state));
}

export function buildIssuesStaticOverview(state: IssuesStaticOverviewState): string {
  const lines: string[] = [
    buildOverviewHeader(state.scope),
    '',
    buildCurrentProfileLine(state),
    '',
    pc.bold('Current Issues'),
    '',
  ];

  if (state.currentIssues.length === 0) {
    lines.push('No current issues.');
  } else {
    lines.push(...buildIssueTableLines(state.currentIssues));
  }

  if (state.scopedLenses.length > 0) {
    lines.push('', pc.bold('Scoped Accounting Lenses'), '');
    lines.push(...buildScopedLensTableLines(state.scopedLenses));
  }

  return `${lines.join('\n')}\n`;
}

export function buildIssuesStaticDetail(state: IssuesStaticDetailState): string {
  const lines: string[] = [
    `${pc.bold(`Issue ${state.issue.issueRef}`)} ${colorizeSeverity(
      state.issue.severity,
      `[${formatSeverityLabel(state.issue.severity)}]`
    )} ${colorizeIssueReviewState(state.issue.reviewState, `[${formatIssueReviewStateLabel(state.issue.reviewState)}]`)} ${pc.cyan(formatFamilyLabel(state.issue.family))}`,
    '',
    buildDetailLine('Scope', formatIssueScope(state.issue)),
    buildDetailLine('Review', formatIssueReviewStateLabel(state.issue.reviewState)),
    buildDetailLine('Summary', state.issue.summary),
    '',
    pc.bold('Details'),
    state.issue.details,
    '',
    pc.bold('Why this matters'),
    state.issue.whyThisMatters,
    '',
    pc.bold('Possible next actions'),
    ...buildNextActionLines(state.issue.issueRef, state.issue.nextActions),
    '',
    pc.bold('Evidence'),
    ...buildEvidenceLines(state.issue.evidenceRefs),
  ];

  return `${lines.join('\n')}\n`;
}

export function buildIssuesStaticScopedList(state: IssuesStaticScopedListState): string {
  const lines: string[] = [
    `${pc.bold('Cost-basis issues')} ${pc.cyan(state.scope.title)}`,
    '',
    buildCurrentProfileLine(state),
    buildDetailLine('Scope', state.scope.scopeKey),
    buildDetailLine('Status', formatScopedStatusLine(state.scope)),
    '',
    pc.bold('Current Issues'),
    '',
  ];

  if (state.currentIssues.length === 0) {
    lines.push('No current issues.');
    return `${lines.join('\n')}\n`;
  }

  lines.push(...buildIssueTableLines(state.currentIssues));
  return `${lines.join('\n')}\n`;
}

function buildOverviewHeader(scope: AccountingIssueScopeSummary): string {
  return `${pc.bold('Issues')} ${scope.openIssueCount} open · ${scope.blockingIssueCount} blocking · ${formatReadiness(scope.status)}`;
}

function buildCurrentProfileLine(
  state: Pick<IssuesStaticOverviewState, 'activeProfileKey' | 'activeProfileSource' | 'profileDisplayName'>
): string {
  const sourceSuffix = state.activeProfileSource === 'default' ? '' : ` (${state.activeProfileSource})`;
  return `${pc.dim('Current profile:')} ${state.profileDisplayName} [key: ${state.activeProfileKey}]${sourceSuffix}`;
}

function buildDetailLine(label: string, value: string): string {
  return `${pc.dim(`${label}:`)} ${value}`;
}

function formatReadiness(status: AccountingIssueScopeSummary['status']): string {
  switch (status) {
    case 'ready':
      return pc.green('Profile ready');
    case 'failed':
      return pc.red('Profile failed');
    case 'has-open-issues':
      return pc.yellow('Profile has open issues');
  }
}

function formatSeverityLabel(severity: AccountingIssueSummaryItem['severity']): string {
  switch (severity) {
    case 'blocked':
      return 'BLOCKED';
    case 'warning':
      return 'WARNING';
  }
}

function colorizeSeverity(severity: AccountingIssueSummaryItem['severity'], value: string): string {
  switch (severity) {
    case 'blocked':
      return pc.red(value);
    case 'warning':
      return pc.yellow(value);
  }
}

function formatFamilyLabel(family: AccountingIssueSummaryItem['family']): string {
  switch (family) {
    case 'asset_review_blocker':
      return 'Asset review blocker';
    case 'execution_failure':
      return 'Execution failure';
    case 'tax_readiness':
      return 'Tax readiness';
    case 'transfer_gap':
      return 'Transfer gap';
  }
}

function formatIssueReviewStateLabel(reviewState: AccountingIssueSummaryItem['reviewState']): string {
  switch (reviewState) {
    case 'acknowledged':
      return 'ACKNOWLEDGED';
    case 'open':
      return 'OPEN';
  }
}

function formatIssueScope(issue: AccountingIssueDetailItem): string {
  return `${issue.scope.kind} (${issue.scope.key})`;
}

function buildNextActionLines(issueRef: string, actions: readonly AccountingIssueNextAction[]): string[] {
  if (actions.length === 0) {
    return ['  No actions available.'];
  }

  return actions.flatMap((action, index) => {
    const commandHint = buildActionCommandHint(issueRef, action);
    const modeLabel = formatActionModeLabel(action.mode);
    const lines = [`  ${index + 1}. ${action.label}`];

    if (commandHint) {
      lines.push(`     ${pc.dim(`${modeLabel} · ${commandHint}`)}`);
    } else {
      lines.push(`     ${pc.dim(modeLabel)}`);
    }

    return lines;
  });
}

function colorizeIssueReviewState(reviewState: AccountingIssueSummaryItem['reviewState'], value: string): string {
  switch (reviewState) {
    case 'acknowledged':
      return pc.cyan(value);
    case 'open':
      return pc.dim(value);
  }
}

function buildEvidenceLines(evidenceRefs: readonly AccountingIssueEvidenceRef[]): string[] {
  if (evidenceRefs.length === 0) {
    return ['  No evidence refs.'];
  }

  return evidenceRefs.map((evidence) => {
    switch (evidence.kind) {
      case 'asset':
        return `  Asset selector ${evidence.selector}`;
      case 'gap':
        return `  GAP-REF ${evidence.ref}`;
      case 'transaction':
        return `  TX-REF ${evidence.ref}`;
    }
  });
}

function formatActionModeLabel(mode: AccountingIssueNextAction['mode']): string {
  switch (mode) {
    case 'direct':
      return 'Direct action';
    case 'review_only':
      return 'Review only';
    case 'routed':
      return 'Routed action';
  }
}

function buildActionCommandHint(issueRef: string, action: AccountingIssueNextAction): string | undefined {
  if (action.mode === 'direct') {
    switch (action.kind) {
      case 'acknowledge_issue':
        return `issues acknowledge ${issueRef}`;
      case 'reopen_acknowledgement':
        return `issues reopen ${issueRef}`;
    }
  }

  if (!action.routeTarget) {
    return undefined;
  }

  switch (action.routeTarget.family) {
    case 'assets':
      return action.routeTarget.selectorValue ? `assets view ${action.routeTarget.selectorValue}` : 'assets';
    case 'links':
      return action.routeTarget.selectorValue ? `links gaps view ${action.routeTarget.selectorValue}` : 'links gaps';
    case 'prices':
      return action.routeTarget.selectorValue
        ? `prices view ${action.routeTarget.selectorValue}`
        : 'prices view --missing-only';
    case 'transactions':
      return action.routeTarget.selectorValue
        ? `transactions view ${action.routeTarget.selectorValue}`
        : 'transactions';
  }
}

function buildIssueTableLines(issues: readonly AccountingIssueSummaryItem[]): string[] {
  const columns = createColumns([...issues], {
    ref: {
      format: (issue) => issue.issueRef,
      minWidth: 'ISSUE-REF'.length,
    },
    severity: {
      format: (issue) => formatSeverityLabel(issue.severity),
      minWidth: 'SEV'.length,
    },
    review: {
      format: (issue) => formatIssueReviewStateLabel(issue.reviewState),
      minWidth: 'REVIEW'.length,
    },
    type: {
      format: (issue) => formatFamilyLabel(issue.family),
      minWidth: 'TYPE'.length,
    },
    summary: {
      format: (issue) => issue.summary,
      minWidth: 'SUMMARY'.length,
    },
    next: {
      format: (issue) => issue.nextActions[0]?.label ?? 'Review',
      minWidth: 'NEXT'.length,
    },
  });
  const lines = [
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          ref: 'ISSUE-REF',
          severity: 'SEV',
          review: 'REVIEW',
          type: 'TYPE',
          summary: 'SUMMARY',
          next: 'NEXT',
        },
        ISSUE_LIST_COLUMN_ORDER,
        { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
      )
    ),
  ];

  for (const issue of issues) {
    const formatted = columns.format(issue);
    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          ref: pc.bold(formatted.ref),
          severity: colorizeSeverity(issue.severity, formatted.severity),
          review: colorizeIssueReviewState(issue.reviewState, formatted.review),
          type: pc.cyan(formatted.type),
          summary: formatted.summary,
          next: pc.dim(formatted.next),
        },
        ISSUE_LIST_COLUMN_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return lines;
}

function buildScopedLensTableLines(scopedLenses: readonly AccountingIssueScopeSummary[]): string[] {
  const columns = createColumns([...scopedLenses], {
    scope: {
      format: (scope) => scope.title,
      minWidth: 'SCOPE'.length,
    },
    status: {
      format: (scope) => formatScopedScopeStatus(scope.status),
      minWidth: 'STATUS'.length,
    },
    open: {
      format: (scope) => String(scope.openIssueCount),
      minWidth: 'OPEN'.length,
    },
    updated: {
      format: (scope) => formatUpdatedAt(scope.updatedAt),
      minWidth: 'UPDATED'.length,
    },
    next: {
      format: (scope) => (scope.openIssueCount === 0 ? 'View readiness' : 'Open scoped issues'),
      minWidth: 'NEXT'.length,
    },
  });
  const lines = [
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          scope: 'SCOPE',
          status: 'STATUS',
          open: 'OPEN',
          updated: 'UPDATED',
          next: 'NEXT',
        },
        SCOPED_LENS_COLUMN_ORDER,
        { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
      )
    ),
  ];

  for (const scope of scopedLenses) {
    const formatted = columns.format(scope);
    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          scope: pc.bold(formatted.scope),
          status: colorizeScopeStatus(scope.status, formatted.status),
          next: pc.dim(formatted.next),
        },
        SCOPED_LENS_COLUMN_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return lines;
}

function formatScopedStatusLine(scope: AccountingIssueScopeSummary): string {
  return `${formatScopedReadinessText(scope.status)} · ${scope.blockingIssueCount} blocking · ${scope.openIssueCount} open`;
}

function formatScopedScopeStatus(status: AccountingIssueScopeSummary['status']): string {
  switch (status) {
    case 'ready':
      return 'READY';
    case 'failed':
      return 'FAILED';
    case 'has-open-issues':
      return 'NOT READY';
  }
}

function formatScopedReadinessText(status: AccountingIssueScopeSummary['status']): string {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'failed':
      return 'failed';
    case 'has-open-issues':
      return 'not ready';
  }
}

function colorizeScopeStatus(status: AccountingIssueScopeSummary['status'], value: string): string {
  switch (status) {
    case 'ready':
      return pc.green(value);
    case 'failed':
      return pc.red(value);
    case 'has-open-issues':
      return pc.yellow(value);
  }
}

function formatUpdatedAt(updatedAt: Date): string {
  return updatedAt.toISOString().slice(0, 16).replace('T', ' ');
}
