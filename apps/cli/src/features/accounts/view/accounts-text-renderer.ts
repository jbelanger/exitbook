import pc from 'picocolors';

import { createColumns } from '../../../ui/shared/table-utils.js';
import type { AccountViewItem } from '../accounts-view-model.js';

import {
  buildTypeParts,
  formatAccountType,
  formatImportCount,
  getProjectionDisplay,
  getVerificationDisplay,
  truncateIdentifier,
  truncateLabel,
  type AccountsStatusColor,
} from './accounts-view-formatters.js';
import type { AccountsViewState } from './accounts-view-state.js';

export function outputAccountsTextSnapshot(state: AccountsViewState): void {
  process.stdout.write(buildAccountsTextSnapshot(state));
}

export function buildAccountsTextSnapshot(state: AccountsViewState): string {
  const lines: string[] = ['', buildHeader(state), ''];

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

function buildHeader(state: AccountsViewState): string {
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
