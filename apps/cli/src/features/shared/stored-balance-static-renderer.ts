import type { AccountType, BalanceSnapshotAssetComparisonStatus } from '@exitbook/core';
import { parseDecimal } from '@exitbook/foundation';
import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../ui/shared/table-utils.js';
import { formatAccountFingerprintRef } from '../accounts/account-selector.js';

import type { StoredBalanceAssetViewItem } from './stored-balance-view.js';

const STORED_BALANCE_COLUMN_GAP = '  ';

type StoredBalanceAssetColumnKey = 'asset' | 'calculated' | 'liveBalance' | 'status' | 'transactions';

export interface StoredBalanceScopeAccountLineItem {
  accountFingerprint: string;
  accountType: AccountType;
  identifier: string;
  name?: string | undefined;
  platformKey: string;
}

export function formatStoredBalanceScopeAccountLine(account: StoredBalanceScopeAccountLineItem): string {
  const label = account.name ?? account.identifier;
  return `${label} ${pc.dim(`(${formatAccountFingerprintRef(account.accountFingerprint)})`)} ${pc.cyan(account.platformKey)} ${pc.dim(account.accountType)}`;
}

export function buildStoredBalanceAssetSectionLines(
  assets: StoredBalanceAssetViewItem[],
  options: {
    emptyMessage?: string | undefined;
    includeLiveBalance?: boolean | undefined;
    includeStatus?: boolean | undefined;
    title: string;
  }
): string[] {
  const lines = [pc.dim(`${options.title} (${assets.length})`)];
  if (assets.length === 0) {
    lines.push(options.emptyMessage ?? 'No stored assets found.');
    return lines;
  }

  const includeLiveBalance = options.includeLiveBalance === true;
  const includeStatus = options.includeStatus === true;
  const columnOrder = buildStoredBalanceAssetColumnOrder(includeLiveBalance, includeStatus);
  const columns = createColumns(assets, {
    asset: {
      format: (asset) => asset.assetSymbol,
      minWidth: 'ASSET'.length,
    },
    calculated: {
      align: 'right',
      format: (asset) => asset.calculatedBalance,
      minWidth: 'CALCULATED'.length,
    },
    liveBalance: {
      align: 'right',
      format: (asset) => asset.liveBalance ?? '—',
      minWidth: 'LAST VERIFIED LIVE'.length,
    },
    status: {
      format: (asset) => asset.comparisonStatus ?? '—',
      minWidth: 'STATUS'.length,
    },
    transactions: {
      align: 'right',
      format: (asset) => `${asset.diagnostics.txCount}`,
      minWidth: 'TXS'.length,
    },
  });

  lines.push(
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          asset: 'ASSET',
          calculated: 'CALCULATED',
          liveBalance: 'LAST VERIFIED LIVE',
          status: 'STATUS',
          transactions: 'TXS',
        },
        columnOrder,
        { alignments: columns.alignments, gap: STORED_BALANCE_COLUMN_GAP }
      )
    )
  );

  for (const asset of assets) {
    const formatted = columns.format(asset);
    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          calculated: colorBalanceValue(formatted.calculated),
          liveBalance:
            asset.liveBalance === undefined ? pc.dim(formatted.liveBalance) : colorBalanceValue(formatted.liveBalance),
          status: colorStoredBalanceStatus(asset.comparisonStatus, formatted.status),
          transactions: pc.dim(formatted.transactions),
        },
        columnOrder,
        { gap: STORED_BALANCE_COLUMN_GAP }
      )
    );
  }

  return lines;
}

function buildStoredBalanceAssetColumnOrder(
  includeLiveBalance: boolean,
  includeStatus: boolean
): StoredBalanceAssetColumnKey[] {
  const columnOrder: StoredBalanceAssetColumnKey[] = ['asset', 'calculated'];

  if (includeLiveBalance) {
    columnOrder.push('liveBalance');
  }

  if (includeStatus) {
    columnOrder.push('status');
  }

  columnOrder.push('transactions');
  return columnOrder;
}

function colorBalanceValue(value: string): string {
  return parseDecimal(value).isNegative() ? pc.red(value) : pc.green(value);
}

function colorStoredBalanceStatus(status: BalanceSnapshotAssetComparisonStatus | undefined, value: string): string {
  switch (status) {
    case 'match':
      return pc.green(value);
    case 'warning':
      return pc.yellow(value);
    case 'mismatch':
      return pc.red(value);
    case 'unavailable':
      return pc.yellow(value);
    case undefined:
      return pc.dim(value);
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
}
