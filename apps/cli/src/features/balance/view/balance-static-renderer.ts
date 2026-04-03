import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';
import { formatAccountFingerprintRef } from '../../accounts/account-selector.js';
import {
  buildStoredBalanceAssetSectionLines,
  formatStoredBalanceScopeAccountLine,
} from '../../shared/stored-balance-static-renderer.js';
import type { StoredSnapshotAccountResult } from '../command/balance-handler-types.js';

import {
  formatBalanceTimestamp,
  getStoredSnapshotVerificationDisplay,
  type BalanceStatusColor,
} from './balance-view-formatters.js';
import type { BalanceStoredSnapshotState } from './balance-view-state.js';

const STATIC_LIST_COLUMN_GAP = '  ';
const BALANCE_LIST_COLUMN_ORDER = ['accountRef', 'name', 'platform', 'type', 'assets', 'verification'] as const;

export function outputBalanceStaticList(state: BalanceStoredSnapshotState): void {
  process.stdout.write(buildBalanceStaticList(state));
}

export function buildBalanceStaticList(state: BalanceStoredSnapshotState): string {
  const lines: string[] = [buildListHeader(state), ''];

  if (state.accounts.length === 0) {
    lines.push(...buildEmptyStateLines());
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(state.accounts, {
    accountRef: {
      format: (item) => formatAccountFingerprintRef(item.accountFingerprint),
      minWidth: 'REF'.length,
    },
    name: {
      format: (item) => truncateValue(item.name ?? item.identifier, 24),
      minWidth: 'NAME'.length,
    },
    platform: {
      format: (item) => item.platformKey,
      minWidth: 'PLATFORM'.length,
    },
    type: {
      format: (item) => item.accountType,
      minWidth: 'TYPE'.length,
    },
    assets: {
      align: 'right',
      format: (item) => `${item.assetCount}`,
      minWidth: 'ASSETS'.length,
    },
    verification: {
      format: (item) => getStoredSnapshotVerificationDisplay(item.verificationStatus)?.listLabel ?? '—',
      minWidth: 'VERIFY'.length,
    },
  });

  lines.push(
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          accountRef: 'REF',
          name: 'NAME',
          platform: 'PLATFORM',
          type: 'TYPE',
          assets: 'ASSETS',
          verification: 'VERIFY',
        },
        BALANCE_LIST_COLUMN_ORDER,
        { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
      )
    )
  );

  for (const account of state.accounts) {
    const formatted = columns.format(account);
    const verification = getStoredSnapshotVerificationDisplay(account.verificationStatus);

    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          name: account.name ? pc.bold(formatted.name) : formatted.name,
          platform: pc.cyan(formatted.platform),
          type: pc.dim(formatted.type),
          verification: verification
            ? colorStatus(verification.color, formatted.verification)
            : pc.dim(formatted.verification),
        },
        BALANCE_LIST_COLUMN_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return `${lines.join('\n')}\n`;
}

export function outputBalanceStaticDetail(result: StoredSnapshotAccountResult): void {
  process.stdout.write(buildBalanceStaticDetail(result));
}

export function buildBalanceStaticDetail(result: StoredSnapshotAccountResult): string {
  const { account, assets, requestedAccount, snapshot } = result;
  const verification = getStoredSnapshotVerificationDisplay(snapshot.verificationStatus);
  const accountLabel = account.name ?? formatAccountFingerprintRef(account.accountFingerprint);
  const lines: string[] = [
    `${pc.bold(accountLabel)}${account.name ? ` ${pc.dim(formatAccountFingerprintRef(account.accountFingerprint))}` : ''} ${pc.cyan(account.platformKey)} ${pc.dim(account.accountType)}`,
    '',
  ];

  if (requestedAccount && requestedAccount.id !== account.id) {
    lines.push(buildDetailLine('Requested', formatStoredBalanceScopeAccountLine(requestedAccount)));
    lines.push(buildDetailLine('Scope', formatStoredBalanceScopeAccountLine(account)));
  } else {
    lines.push(buildDetailLine('Account', formatStoredBalanceScopeAccountLine(account)));
  }

  lines.push(buildDetailLine('Fingerprint', account.accountFingerprint));
  lines.push(buildDetailLine('Identifier', account.identifier));
  lines.push(
    buildDetailLine(
      'Verification',
      verification ? colorStatus(verification.color, `${verification.icon} ${verification.label}`) : pc.dim('—')
    )
  );

  if (snapshot.lastRefreshAt) {
    lines.push(buildDetailLine('Last refresh', pc.dim(formatBalanceTimestamp(snapshot.lastRefreshAt.toISOString()))));
  }

  if (snapshot.statusReason) {
    lines.push(buildDetailLine('Status', pc.yellow(snapshot.statusReason)));
  }

  if (snapshot.suggestion) {
    lines.push(buildDetailLine('Suggestion', pc.dim(snapshot.suggestion)));
  }

  lines.push(
    '',
    ...buildStoredBalanceAssetSectionLines(assets, {
      title: 'Assets',
    })
  );

  return `${lines.join('\n')}\n`;
}

function buildListHeader(state: BalanceStoredSnapshotState): string {
  const filterLabel = state.sourceFilter ? ` (${state.sourceFilter})` : '';
  return `${pc.bold(`Balances${filterLabel}`)} ${pc.dim(`${state.totalAccounts} accounts · stored snapshots`)}`;
}

function buildEmptyStateLines(): string[] {
  return [
    'No accounts found.',
    '',
    'Add an account, then sync it:',
    pc.dim('exitbook accounts add kucoin-main --exchange kucoin --csv-dir ./exports/kucoin'),
    pc.dim('exitbook import kucoin-main'),
  ];
}

function buildDetailLine(label: string, value: string): string {
  return `${pc.dim(`${label}:`)} ${value}`;
}

function truncateValue(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxWidth - 1))}…`;
}

function colorStatus(color: BalanceStatusColor, value: string): string {
  switch (color) {
    case 'green':
      return pc.green(value);
    case 'yellow':
      return pc.yellow(value);
    case 'red':
      return pc.red(value);
    case 'dim':
      return pc.dim(value);
  }

  const exhaustiveCheck: never = color;
  return exhaustiveCheck;
}
