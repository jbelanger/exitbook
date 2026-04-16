import pc from 'picocolors';

import { buildTextTableHeader, buildTextTableRow, createColumns } from '../../../ui/shared/table-utils.js';
import type { AssetViewItem } from '../command/assets-types.js';

import {
  formatAssetCoinGeckoReferenceStatus,
  formatAssetEvidenceMessage,
  getAssetBadge,
  getAssetBlockchainTokenIdentity,
  getAssetReason,
  getAssetReasonWithHint,
  getConflictingAssetIds,
  getPrimaryAssetSymbol,
  getAssetStaticActionHint,
  getAssetTransactionInspectionHint,
  pluralizeAssetLabel,
} from './assets-view-formatters.js';
import type { AssetsViewState } from './assets-view-state.js';

const STATIC_LIST_COLUMN_GAP = '  ';
const ASSET_LIST_COLUMN_ORDER = ['symbol', 'quantity', 'status', 'why', 'assetId'] as const;

export function outputAssetsStaticList(state: AssetsViewState): void {
  process.stdout.write(buildAssetsStaticList(state));
}

export function buildAssetsStaticList(state: AssetsViewState): string {
  const lines: string[] = [buildListHeader(state), ''];

  if (state.filteredAssets.length === 0) {
    lines.push(
      state.filter === 'action-required'
        ? 'No flagged assets need attention.'
        : 'No assets with holdings, exclusions, or review flags.'
    );
    return `${lines.join('\n')}\n`;
  }

  const columns = createColumns(state.filteredAssets, {
    symbol: { format: (item) => getPrimaryAssetSymbol(item), minWidth: 'SYMBOL'.length },
    quantity: {
      format: (item) => item.currentQuantity,
      align: 'right',
      minWidth: 'QUANTITY'.length,
    },
    status: {
      format: (item) => getAssetBadge(item)?.label ?? '—',
      minWidth: 'STATUS'.length,
    },
    why: {
      format: (item) => getAssetReasonWithHint(item) ?? '—',
      minWidth: 'WHY'.length,
    },
    assetId: {
      format: (item) => item.assetId,
      minWidth: 'ASSET ID'.length,
    },
  });

  lines.push(
    pc.dim(
      buildTextTableHeader(
        columns.widths,
        {
          symbol: 'SYMBOL',
          quantity: 'QUANTITY',
          status: 'STATUS',
          why: 'WHY',
          assetId: 'ASSET ID',
        },
        ASSET_LIST_COLUMN_ORDER,
        { alignments: columns.alignments, gap: STATIC_LIST_COLUMN_GAP }
      )
    )
  );

  for (const asset of state.filteredAssets) {
    const formatted = columns.format(asset);
    const badge = getAssetBadge(asset);

    lines.push(
      buildTextTableRow(
        {
          ...formatted,
          symbol: pc.bold(pc.cyan(formatted.symbol)),
          status: colorBadgeText(badge?.color, formatted.status),
          why: formatted.why === '—' ? pc.dim(formatted.why) : pc.dim(formatted.why),
          assetId: pc.dim(formatted.assetId),
        },
        ASSET_LIST_COLUMN_ORDER,
        { gap: STATIC_LIST_COLUMN_GAP }
      )
    );
  }

  return `${lines.join('\n')}\n`;
}

export function outputAssetStaticDetail(asset: AssetViewItem): void {
  process.stdout.write(buildAssetStaticDetail(asset));
}

export function buildAssetStaticDetail(asset: AssetViewItem): string {
  const badge = getAssetBadge(asset);
  const reason = getAssetReason(asset);
  const tokenIdentity = getAssetBlockchainTokenIdentity(asset.assetId);
  const ambiguityEvidence = asset.evidence.find((item) => item.kind === 'same-symbol-ambiguity');
  const conflictingAssetIds = ambiguityEvidence
    ? getConflictingAssetIds(ambiguityEvidence.metadata, asset.assetId)
    : [];
  const transactionInspectionHint = getAssetTransactionInspectionHint(asset);

  const lines: string[] = [
    `${pc.bold(getPrimaryAssetSymbol(asset))} ${pc.dim(asset.currentQuantity)}${badge ? ` ${colorBadgeText(badge.color, `[${badge.label}]`)}` : ''}`,
    '',
    buildDetailLine('Asset ID', asset.assetId),
  ];

  if (asset.assetSymbols.length > 1) {
    lines.push(buildDetailLine('Also seen as', asset.assetSymbols.join(', ')));
  }

  if (tokenIdentity) {
    lines.push(buildDetailLine('Contract', `${tokenIdentity.chain} ${tokenIdentity.ref}`));
    lines.push(buildDetailLine('CoinGecko', formatAssetCoinGeckoReferenceStatus(asset.referenceStatus)));
  }

  for (const conflictingAssetId of conflictingAssetIds) {
    lines.push(buildDetailLine('Conflict asset', conflictingAssetId));
  }

  if (reason) {
    lines.push(buildDetailLine('Why', reason));
  }

  lines.push(buildDetailLine('Action', getAssetStaticActionHint(asset)));
  if (transactionInspectionHint) {
    lines.push(buildDetailLine('Inspect', transactionInspectionHint));
  }
  lines.push(
    buildDetailLine(
      'Seen in',
      `${asset.transactionCount} ${pluralizeAssetLabel(asset.transactionCount, 'transaction')} · ${asset.movementCount} ${pluralizeAssetLabel(asset.movementCount, 'movement')}`
    )
  );

  if (asset.evidence.length > 0) {
    lines.push('');
    lines.push(pc.dim('Signals'));
    for (const evidence of asset.evidence) {
      lines.push(
        `  ${evidence.severity === 'error' ? pc.red('•') : pc.yellow('•')} ${formatAssetEvidenceMessage(evidence.kind)}`
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function buildListHeader(state: AssetsViewState): string {
  const excludedLabel = `${state.excludedCount} excluded`;

  if (state.filter === 'action-required') {
    return `${pc.bold('Review Queue')} ${pc.yellow(
      `${state.filteredAssets.length} flagged ${pluralizeAssetLabel(state.filteredAssets.length, 'asset')}`
    )}${pc.dim(` · ${excludedLabel}`)}`;
  }

  const countLabel =
    state.filteredAssets.length === state.totalCount
      ? `${state.totalCount}`
      : `${state.filteredAssets.length} of ${state.totalCount}`;

  return `${pc.bold('Assets')} ${pc.dim(countLabel)}${pc.dim(' · ')}${pc.yellow(
    `${state.actionRequiredCount} flagged`
  )}${pc.dim(` · ${excludedLabel}`)}`;
}

function buildDetailLine(label: string, value: string): string {
  return `${pc.dim(`${label}:`)} ${value}`;
}

function colorBadgeText(color: 'gray' | 'green' | 'yellow' | undefined, value: string): string {
  switch (color) {
    case 'gray':
      return pc.dim(value);
    case 'green':
      return pc.green(value);
    case 'yellow':
      return pc.yellow(value);
    default:
      return value;
  }
}
