import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';
import type {
  AccountDetailViewItem,
  AccountViewItem,
  ChildAccountViewItem,
  SessionViewItem,
} from '../accounts-view-model.js';
import {
  buildStoredBalanceAssetSectionLines,
  formatStoredBalanceScopeAccountLine,
} from '../stored-balance/stored-balance-static-renderer.js';

import {
  ACCOUNT_FINGERPRINT_REF_LENGTH,
  buildTypeParts,
  formatAccountFingerprintRef,
  formatAccountType,
  formatImportCount,
  formatTimestamp,
  getBalanceDataDetailDisplay,
  getProjectionDisplay,
  getSessionDisplay,
  getLiveCheckDetailDisplay,
  getVerificationDisplay,
  shouldShowAccountDetailStatus,
  truncateIdentifier,
  truncateLabel,
  type AccountsStatusColor,
} from './accounts-view-formatters.js';
import type { AccountsListViewState } from './accounts-view-state.js';

const STATIC_LIST_COLUMN_GAP = '  ';
const ACCOUNT_REF_COLUMN_LABEL = 'ACCT-REF';
const ACCOUNT_LIST_COLUMN_ORDER = ['accountRef', 'name', 'platform', 'type', 'assets', 'identifier'] as const;

export function outputAccountsStaticList(state: AccountsListViewState): void {
  process.stdout.write(buildAccountsStaticList(state));
}

export function buildAccountsStaticList(state: AccountsListViewState): string {
  const lines: string[] = [buildListHeader(state), ''];

  if (state.accounts.length === 0) {
    lines.push(...buildEmptyStateLines(state));
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(state.accounts, {
    accountRef: {
      format: (item) => formatAccountFingerprintRef(item.accountFingerprint),
      align: 'left',
      minWidth: Math.max(ACCOUNT_FINGERPRINT_REF_LENGTH, ACCOUNT_REF_COLUMN_LABEL.length),
    },
    name: { format: (item) => truncateLabel(item.name ?? item.identifier, item.name ? 20 : 28) },
    platform: { format: (item) => item.platformKey, minWidth: 12 },
    type: { format: (item) => formatAccountType(item.accountType), minWidth: 13 },
    assets: {
      align: 'right',
      format: (item) => formatStoredAssetCount(item),
      minWidth: 'ASSETS'.length,
    },
    identifier: {
      format: (item) => (item.name ? truncateIdentifier(item.identifier, item.accountType, 16) : '—'),
      minWidth: 16,
    },
  });

  lines.push(buildListColumnHeader(columns));
  for (const item of state.accounts) {
    lines.push(buildAccountRow(item, columns));
  }

  return `${lines.join('\n')}\n`;
}

export function outputAccountStaticDetail(account: AccountDetailViewItem): void {
  process.stdout.write(buildAccountStaticDetail(account));
}

export function buildAccountStaticDetail(account: AccountDetailViewItem): string {
  const type = formatAccountType(account.accountType);
  const fingerprintRef = formatAccountFingerprintRef(account.accountFingerprint);
  const title = account.name ? account.name : fingerprintRef;
  const lines: string[] = [
    `${pc.bold(title)}${account.name ? ` ${pc.dim(fingerprintRef)}` : ''} ${pc.cyan(account.platformKey)} ${pc.dim(type)}`,
    '',
    buildDetailLine('Name', account.name ?? pc.dim('—')),
    buildDetailLine('Account ref', fingerprintRef),
    buildDetailLine('Fingerprint', account.accountFingerprint),
    buildDetailLine('Identifier', account.identifier),
    buildDetailLine('Provider', account.providerName ? pc.cyan(account.providerName) : pc.dim('—')),
    buildDetailLine('Created', pc.dim(formatTimestamp(account.createdAt))),
  ];

  if (shouldShowAccountDetailStatus(account)) {
    const liveCheck = getLiveCheckDetailDisplay(account.verificationStatus);
    const balanceData = getBalanceDataDetailDisplay(account.balanceProjectionStatus);
    lines.push(
      '',
      `${pc.dim('Balance data:')} ${colorStatus(balanceData.iconColor, `${balanceData.icon} ${balanceData.label}`)}${pc.dim(' · Live check: ')}${colorStatus(liveCheck.iconColor, `${liveCheck.icon} ${liveCheck.label}`)}`
    );
  }

  if (account.lastCalculatedAt) {
    lines.push(buildDetailLine('Last calculated', pc.dim(formatTimestamp(account.lastCalculatedAt))));
  }
  if (account.lastRefreshAt) {
    lines.push(buildDetailLine('Last refresh', pc.dim(formatTimestamp(account.lastRefreshAt))));
  }
  if (account.sessionCount !== undefined) {
    lines.push(buildDetailLine('Imports', String(account.sessionCount)));
  }
  if (account.requestedAccount) {
    lines.push(buildDetailLine('Requested', formatStoredBalanceScopeAccountLine(account.requestedAccount)));
    lines.push(buildDetailLine('Balance scope', formatStoredBalanceScopeAccountLine(account.balance.scopeAccount)));
  }
  lines.push('', ...buildStoredBalanceLines(account));
  if (account.childAccounts && account.childAccounts.length > 0) {
    lines.push('', ...buildChildAccountLines(account.childAccounts));
  }
  if (account.sessions && account.sessions.length > 0) {
    lines.push('', ...buildSessionLines(account.sessions));
  }

  return `${lines.join('\n')}\n`;
}

function buildListHeader(state: AccountsListViewState): string {
  let filterLabel = '';
  if (state.filters.platformFilter) filterLabel = ` (${state.filters.platformFilter})`;
  else if (state.filters.typeFilter) filterLabel = ` (${state.filters.typeFilter})`;

  const metadata = [
    `${state.totalCount} total`,
    ...buildTypeParts(state.typeCounts).map((part) => `${part.count} ${part.label}`),
  ].filter((part): part is string => part !== undefined);

  return `${pc.bold(`Accounts${filterLabel}`)} ${pc.dim(metadata.join(' · '))}`;
}

function buildEmptyStateLines(state: AccountsListViewState): string[] {
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
  columns: ReturnType<
    typeof createColumns<AccountViewItem, 'accountRef' | 'name' | 'platform' | 'type' | 'assets' | 'identifier'>
  >
): string {
  const formatted = columns.format(item);
  const { assets, identifier, name, platform, type } = formatted;

  return buildTextTableRow(
    {
      ...formatted,
      assets: pc.dim(assets),
      identifier: pc.dim(identifier),
      name: item.name ? pc.bold(name) : name,
      platform: pc.cyan(platform),
      type: pc.dim(type),
    },
    ACCOUNT_LIST_COLUMN_ORDER,
    { gap: STATIC_LIST_COLUMN_GAP }
  );
}

function buildListColumnHeader(
  columns: ReturnType<
    typeof createColumns<AccountViewItem, 'accountRef' | 'name' | 'platform' | 'type' | 'assets' | 'identifier'>
  >
): string {
  return pc.dim(
    buildTextTableHeader(
      columns.widths,
      {
        accountRef: ACCOUNT_REF_COLUMN_LABEL,
        assets: 'ASSETS',
        identifier: 'IDENTIFIER',
        name: 'NAME',
        platform: 'PLATFORM',
        type: 'TYPE',
      },
      ACCOUNT_LIST_COLUMN_ORDER,
      { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
    )
  );
}

function buildDetailLine(label: string, value: string): string {
  return `${pc.dim(`${label}:`)} ${value}`;
}

function buildStoredBalanceLines(account: AccountDetailViewItem): string[] {
  if (!account.balance.readable) {
    return [pc.dim('Balances'), account.balance.reason, `Next: ${account.balance.hint}.`];
  }

  const lines = buildStoredBalanceAssetSectionLines(account.balance.assets, {
    title: 'Balances',
    includeLiveBalance: true,
    includeStatus: true,
  });

  if (account.balance.statusReason) {
    lines.splice(1, 0, buildDetailLine('Status', pc.yellow(account.balance.statusReason)));
  }

  if (account.balance.suggestion) {
    lines.splice(
      account.balance.statusReason ? 2 : 1,
      0,
      buildDetailLine('Suggestion', pc.dim(account.balance.suggestion))
    );
  }

  return lines;
}

function buildChildAccountLines(children: ChildAccountViewItem[]): string[] {
  const lines = [pc.dim(`Derived addresses (${children.length})`)];

  lines.push(
    ...children.map((child) => {
      const projection = getProjectionDisplay(child.balanceProjectionStatus);
      const verification = getVerificationDisplay(child.verificationStatus);
      const imports = child.sessionCount !== undefined ? formatImportCount(child.sessionCount) : '';
      const fingerprintRef = formatAccountFingerprintRef(child.accountFingerprint);

      return `  ${fingerprintRef} ${truncateIdentifier(child.identifier, 'blockchain', 32)} ${pc.dim(imports)} ${pc.dim('proj:')}${colorStatus(projection.iconColor, projection.listLabel)} ${pc.dim('ver:')}${colorStatus(verification.iconColor, verification.listLabel)}`.trimEnd();
    })
  );

  return lines;
}

function buildSessionLines(sessions: SessionViewItem[]): string[] {
  const lines = [pc.dim('Recent sessions')];

  lines.push(
    ...sessions.map((session) => {
      const { icon, iconColor } = getSessionDisplay(session.status);
      const completed = session.completedAt ? ` -> ${formatTimestamp(session.completedAt)}` : ' -> -';
      return `  ${colorStatus(iconColor, icon)} #${session.id} ${colorStatus(iconColor, session.status)} ${pc.dim(`${formatTimestamp(session.startedAt)}${completed}`)}`;
    })
  );

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

function formatStoredAssetCount(account: AccountViewItem): string {
  if (account.balanceProjectionStatus !== 'fresh' || account.storedAssetCount === undefined) {
    return '—';
  }

  return `${account.storedAssetCount}`;
}
