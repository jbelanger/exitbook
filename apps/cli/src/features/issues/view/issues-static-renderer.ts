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
const ISSUE_LIST_COLUMN_ORDER = ['ref', 'severity', 'type', 'summary', 'next'] as const;

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

export function outputIssuesStaticOverview(state: IssuesStaticOverviewState): void {
  process.stdout.write(buildIssuesStaticOverview(state));
}

export function outputIssuesStaticDetail(state: IssuesStaticDetailState): void {
  process.stdout.write(buildIssuesStaticDetail(state));
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
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(state.currentIssues, {
    ref: {
      format: (issue) => issue.issueRef,
      minWidth: 'ISSUE-REF'.length,
    },
    severity: {
      format: (issue) => formatSeverityLabel(issue.severity),
      minWidth: 'SEV'.length,
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

  lines.push(
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          ref: 'ISSUE-REF',
          severity: 'SEV',
          type: 'TYPE',
          summary: 'SUMMARY',
          next: 'NEXT',
        },
        ISSUE_LIST_COLUMN_ORDER,
        { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
      )
    )
  );

  for (const issue of state.currentIssues) {
    const formatted = columns.format(issue);
    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          ref: pc.bold(formatted.ref),
          severity: colorizeSeverity(issue.severity, formatted.severity),
          type: pc.cyan(formatted.type),
          summary: formatted.summary,
          next: pc.dim(formatted.next),
        },
        ISSUE_LIST_COLUMN_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return `${lines.join('\n')}\n`;
}

export function buildIssuesStaticDetail(state: IssuesStaticDetailState): string {
  const lines: string[] = [
    `${pc.bold(`Issue ${state.issue.issueRef}`)} ${colorizeSeverity(
      state.issue.severity,
      `[${formatSeverityLabel(state.issue.severity)}]`
    )} ${pc.cyan(formatFamilyLabel(state.issue.family))}`,
    '',
    buildDetailLine('Scope', formatIssueScope(state.issue)),
    buildDetailLine('Summary', state.issue.summary),
    '',
    pc.bold('Details'),
    state.issue.details,
    '',
    pc.bold('Why this matters'),
    state.issue.whyThisMatters,
    '',
    pc.bold('Possible next actions'),
    ...buildNextActionLines(state.issue.nextActions),
    '',
    pc.bold('Evidence'),
    ...buildEvidenceLines(state.issue.evidenceRefs),
  ];

  return `${lines.join('\n')}\n`;
}

function buildOverviewHeader(scope: AccountingIssueScopeSummary): string {
  return `${pc.bold('Issues')} ${scope.openIssueCount} open · ${scope.blockingIssueCount} blocking · ${formatReadiness(scope.status)}`;
}

function buildCurrentProfileLine(state: IssuesStaticOverviewState): string {
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
    case 'transfer_gap':
      return 'Transfer gap';
  }
}

function formatIssueScope(issue: AccountingIssueDetailItem): string {
  return `${issue.scope.kind} (${issue.scope.key})`;
}

function buildNextActionLines(actions: readonly AccountingIssueNextAction[]): string[] {
  if (actions.length === 0) {
    return ['  No actions available.'];
  }

  return actions.flatMap((action, index) => {
    const commandHint = buildActionCommandHint(action);
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

function buildActionCommandHint(action: AccountingIssueNextAction): string | undefined {
  if (!action.routeTarget) {
    return undefined;
  }

  switch (action.routeTarget.family) {
    case 'assets':
      return action.routeTarget.selectorValue ? `assets view ${action.routeTarget.selectorValue}` : 'assets';
    case 'links':
      return action.routeTarget.selectorValue ? `links gaps view ${action.routeTarget.selectorValue}` : 'links gaps';
    case 'prices':
      return action.routeTarget.selectorValue ? `prices view ${action.routeTarget.selectorValue}` : 'prices';
    case 'transactions':
      return action.routeTarget.selectorValue
        ? `transactions view ${action.routeTarget.selectorValue}`
        : 'transactions';
  }
}
