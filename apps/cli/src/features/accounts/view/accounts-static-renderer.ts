import pc from 'picocolors';

import { createColumns } from '../../../ui/shared/table-utils.js';
import type { AccountViewItem, ChildAccountViewItem, SessionViewItem } from '../accounts-view-model.js';

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
  type AccountsStatusColor,
} from './accounts-view-formatters.js';
import type { AccountsViewState } from './accounts-view-state.js';

export function outputAccountsStaticList(state: AccountsViewState): void {
  process.stdout.write(buildAccountsStaticList(state));
}

export function buildAccountsStaticList(state: AccountsViewState): string {
  const lines: string[] = ['', buildListHeader(state), ''];

  if (state.accounts.length === 0) {
    lines.push(...buildEmptyStateLines(state));
    return `${lines.join('\n')}\n\n`;
  }

  const columns = createColumns(state.accounts, {
    acctId: { format: (item) => `#${item.id}`, align: 'right', minWidth: 5 },
    platform: { format: (item) => item.platformKey, minWidth: 12 },
    type: { format: (item) => formatAccountType(item.accountType), minWidth: 13 },
  });

  for (const item of state.accounts) {
    lines.push(buildAccountRow(item, columns));
  }

  return `${lines.join('\n')}\n\n`;
}

export function outputAccountStaticDetail(account: AccountViewItem): void {
  process.stdout.write(buildAccountStaticDetail(account));
}

export function buildAccountStaticDetail(account: AccountViewItem): string {
  const type = formatAccountType(account.accountType);
  const verification = getVerificationDisplay(account.verificationStatus);
  const projection = getProjectionDisplay(account.balanceProjectionStatus);
  const title = account.name ? account.name : `#${account.id}`;
  const lines: string[] = [
    '',
    `${pc.bold(title)}${account.name ? ` ${pc.dim(`#${account.id}`)}` : ''} ${pc.cyan(account.platformKey)} ${pc.dim(type)}`,
    '',
    buildDetailLine('Name', account.name ?? pc.dim('—')),
    buildDetailLine('Identifier', account.identifier),
    buildDetailLine('Provider', account.providerName ? pc.cyan(account.providerName) : pc.dim('—')),
    buildDetailLine('Created', pc.dim(formatTimestamp(account.createdAt))),
    '',
    `${pc.dim('Verification:')} ${colorStatus(verification.iconColor, `${verification.icon} ${verification.label}`)}${pc.dim(' · Projection: ')}${colorStatus(projection.iconColor, `${projection.icon} ${projection.label}`)}`,
  ];

  if (account.lastRefreshAt) {
    lines.push(buildDetailLine('Last refresh', pc.dim(formatTimestamp(account.lastRefreshAt))));
  }
  if (account.sessionCount !== undefined) {
    lines.push(buildDetailLine('Imports', formatImportCount(account.sessionCount)));
  }
  if (account.childAccounts && account.childAccounts.length > 0) {
    lines.push('', ...buildChildAccountLines(account.childAccounts));
  }
  if (account.sessions && account.sessions.length > 0) {
    lines.push('', ...buildSessionLines(account.sessions));
  }

  return `${lines.join('\n')}\n\n`;
}

function buildListHeader(state: AccountsViewState): string {
  let filterLabel = '';
  if (state.filters.platformFilter) filterLabel = ` (${state.filters.platformFilter})`;
  else if (state.filters.typeFilter) filterLabel = ` (${state.filters.typeFilter})`;

  const metadata = [
    `${state.totalCount} total`,
    ...buildTypeParts(state.typeCounts).map((part) => `${part.count} ${part.label}`),
    state.filters.showSessions ? 'sessions visible' : undefined,
  ].filter((part): part is string => part !== undefined);

  return `${pc.bold(`Accounts${filterLabel}`)} ${pc.dim(metadata.join(' · '))}`;
}

function buildEmptyStateLines(state: AccountsViewState): string[] {
  const hasFilters = state.filters.platformFilter || state.filters.typeFilter;

  if (!hasFilters && state.totalCount === 0) {
    return [
      'No accounts found.',
      '',
      pc.dim('Tip: exitbook accounts add my-wallet --blockchain ethereum --address 0x...'),
    ];
  }

  return [
    `No accounts found${state.filters.platformFilter ? ` for ${state.filters.platformFilter}` : ''}${state.filters.typeFilter ? ` of type ${state.filters.typeFilter}` : ''}.`,
  ];
}

function buildAccountRow(
  item: AccountViewItem,
  columns: ReturnType<typeof createColumns<AccountViewItem, 'acctId' | 'platform' | 'type'>>
): string {
  const { acctId, platform, type } = columns.format(item);
  const label = truncateLabel(item.name ?? item.identifier, item.name ? 20 : 28);
  const identifierSuffix = item.name ? truncateIdentifier(item.identifier, item.accountType, 16) : undefined;
  const imports = item.sessionCount !== undefined ? formatImportCount(item.sessionCount) : '';
  const projection = getProjectionDisplay(item.balanceProjectionStatus);
  const verification = getVerificationDisplay(item.verificationStatus);
  const children = item.childAccounts && item.childAccounts.length > 0 ? ` +${item.childAccounts.length} derived` : '';

  const parts = [
    acctId,
    pc.cyan(platform),
    pc.dim(type),
    item.name ? pc.bold(label) : label,
    identifierSuffix ? pc.dim(identifierSuffix) : undefined,
    imports || children ? pc.dim(`${imports}${children}`) : undefined,
    `${pc.dim('proj:')}${colorStatus(projection.iconColor, projection.listLabel)}`,
    `${pc.dim('ver:')}${colorStatus(verification.iconColor, verification.listLabel)}`,
  ].filter((part): part is string => part !== undefined && part.length > 0);

  return parts.join(' ');
}

function buildDetailLine(label: string, value: string): string {
  return `${pc.dim(`${label}:`)} ${value}`;
}

function buildChildAccountLines(children: ChildAccountViewItem[]): string[] {
  const lines = [pc.dim(`Derived addresses (${children.length})`)];

  lines.push(
    ...children.slice(0, 5).map((child) => {
      const projection = getProjectionDisplay(child.balanceProjectionStatus);
      const verification = getVerificationDisplay(child.verificationStatus);
      const imports = child.sessionCount !== undefined ? formatImportCount(child.sessionCount) : '';

      return `  #${child.id} ${truncateIdentifier(child.identifier, 'blockchain', 32)} ${pc.dim(imports)} ${pc.dim('proj:')}${colorStatus(projection.iconColor, projection.listLabel)} ${pc.dim('ver:')}${colorStatus(verification.iconColor, verification.listLabel)}`.trimEnd();
    })
  );

  if (children.length > 5) {
    lines.push(pc.dim(`  ...and ${children.length - 5} more`));
  }

  return lines;
}

function buildSessionLines(sessions: SessionViewItem[]): string[] {
  const lines = [pc.dim('Recent sessions')];

  lines.push(
    ...sessions.slice(0, 5).map((session) => {
      const { icon, iconColor } = getSessionDisplay(session.status);
      const completed = session.completedAt ? ` -> ${formatTimestamp(session.completedAt)}` : ' -> -';
      return `  ${colorStatus(iconColor, icon)} #${session.id} ${colorStatus(iconColor, session.status)} ${pc.dim(`${formatTimestamp(session.startedAt)}${completed}`)}`;
    })
  );

  if (sessions.length > 5) {
    lines.push(pc.dim(`  ...and ${sessions.length - 5} more`));
  }

  return lines;
}

function colorStatus(color: AccountsStatusColor, value: string): string {
  switch (color) {
    case 'green':
      return pc.green(value);
    case 'yellow':
      return pc.yellow(value);
    case 'red':
      return pc.red(value);
    case 'cyan':
      return pc.cyan(value);
    case 'dim':
      return pc.dim(value);
  }

  const exhaustiveCheck: never = color;
  return exhaustiveCheck;
}
