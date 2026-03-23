import { parseAssetId } from '@exitbook/foundation';
import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useReducer, type FC, type ReactElement } from 'react';

import { type Columns, createColumns, Divider, FixedHeightDetail, SelectableRow } from '../../../ui/shared/index.js';
import { requiresAssetReviewAction } from '../asset-view-filter.js';
import type { AssetReviewOverrideResult, AssetOverrideResult, AssetViewItem } from '../command/assets-handler.js';

import { assetsViewReducer, handleAssetsKeyboardInput } from './assets-view-controller.js';
import { ASSET_DETAIL_LINES, getAssetsVisibleRows } from './assets-view-layout.js';
import type { AssetsViewState } from './assets-view-state.js';

export const AssetsViewApp: FC<{
  initialState: AssetsViewState;
  onClearReview: (assetId: string) => Promise<AssetReviewOverrideResult>;
  onConfirmReview: (assetId: string) => Promise<AssetReviewOverrideResult>;
  onQuit: () => void;
  onToggleExclusion: (assetId: string, excluded: boolean) => Promise<AssetOverrideResult>;
}> = ({ initialState, onClearReview, onConfirmReview, onQuit, onToggleExclusion }) => {
  const [state, dispatch] = useReducer(assetsViewReducer, initialState);
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  useInput((input, key) => {
    handleAssetsKeyboardInput(input, key, dispatch, onQuit, terminalHeight, state);
  });

  useEffect(() => {
    if (!state.pendingAction) {
      return;
    }

    const selected = state.assets.find((asset) => asset.assetId === state.pendingAction?.assetId);
    if (!selected) {
      dispatch({ type: 'SET_ERROR', error: `Selected asset no longer exists: ${state.pendingAction.assetId}` });
      return;
    }

    if (state.pendingAction.type === 'toggle-exclusion') {
      void onToggleExclusion(selected.assetId, selected.excluded)
        .then(() => {
          dispatch({
            type: 'TOGGLE_EXCLUSION_SUCCESS',
            assetId: selected.assetId,
            excluded: !selected.excluded,
          });
        })
        .catch((error: unknown) => {
          dispatch({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) });
        });
      return;
    }

    if (state.pendingAction.type === 'confirm-review') {
      void onConfirmReview(selected.assetId)
        .then((result) => {
          dispatch({
            type: 'CONFIRM_REVIEW_SUCCESS',
            assetId: selected.assetId,
            review: {
              accountingBlocked: result.accountingBlocked,
              confirmationIsStale: result.confirmationIsStale,
              evidence: result.evidence,
              evidenceFingerprint: result.evidenceFingerprint,
              referenceStatus: result.referenceStatus,
              reviewStatus: result.reviewStatus,
              warningSummary: result.warningSummary,
            },
          });
        })
        .catch((error: unknown) => {
          dispatch({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) });
        });
      return;
    }

    void onClearReview(selected.assetId)
      .then((result) => {
        dispatch({
          type: 'CLEAR_REVIEW_SUCCESS',
          assetId: selected.assetId,
          review: {
            accountingBlocked: result.accountingBlocked,
            confirmationIsStale: result.confirmationIsStale,
            evidence: result.evidence,
            evidenceFingerprint: result.evidenceFingerprint,
            referenceStatus: result.referenceStatus,
            reviewStatus: result.reviewStatus,
            warningSummary: result.warningSummary,
          },
        });
      })
      .catch((error: unknown) => {
        dispatch({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) });
      });
  }, [onClearReview, onConfirmReview, onToggleExclusion, state.assets, state.pendingAction]);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <AssetsHeader state={state} />
      <Text> </Text>
      <AssetList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <AssetDetailPanel state={state} />
      {state.error && (
        <>
          <Text> </Text>
          <Text>
            <Text color="yellow">!</Text> {state.error}
          </Text>
        </>
      )}
      {!state.error && state.statusMessage && (
        <>
          <Text> </Text>
          <Text>
            <Text color="green">✓</Text> {state.statusMessage}
          </Text>
        </>
      )}
      <Text> </Text>
      <AssetsControlsBar state={state} />
    </Box>
  );
};

const AssetsHeader: FC<{ state: AssetsViewState }> = ({ state }) => {
  const flaggedLabel = `${state.actionRequiredCount} flagged`;
  const excludedLabel = `${state.excludedCount} excluded`;

  if (state.filter === 'action-required') {
    return (
      <Box>
        <Text bold>Review Queue</Text>
        <Text> </Text>
        <Text>{state.filteredAssets.length}</Text>
        <Text dimColor> flagged {pluralize(state.filteredAssets.length, 'asset')}</Text>
        <Text dimColor> · </Text>
        <Text dimColor>{excludedLabel}</Text>
      </Box>
    );
  }

  const countLabel =
    state.filteredAssets.length === state.totalCount
      ? `${state.totalCount}`
      : `${state.filteredAssets.length} of ${state.totalCount}`;

  return (
    <Box>
      <Text bold>Assets</Text>
      <Text> </Text>
      <Text>{countLabel}</Text>
      <Text dimColor> · </Text>
      <Text color="yellow">{flaggedLabel}</Text>
      <Text dimColor> · </Text>
      <Text dimColor>{excludedLabel}</Text>
    </Box>
  );
};

const AssetList: FC<{ state: AssetsViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const visibleRows = getAssetsVisibleRows(
    terminalHeight,
    state.error !== undefined || state.statusMessage !== undefined
  );
  const startIndex = state.scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, state.filteredAssets.length);
  const visibleAssets = state.filteredAssets.slice(startIndex, endIndex);
  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < state.filteredAssets.length;

  if (state.filteredAssets.length === 0) {
    return (
      <Text dimColor>
        {state.filter === 'action-required'
          ? 'No flagged assets need attention.'
          : 'No assets with holdings, exclusions, or review flags.'}
      </Text>
    );
  }

  const columns = createColumns(state.filteredAssets, {
    symbol: { format: (item) => item.assetSymbols[0] ?? '(unknown)', minWidth: 4 },
    quantity: { format: (item) => item.currentQuantity, minWidth: 1 },
  });

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}▲ {startIndex} more above
        </Text>
      )}
      {visibleAssets.map((asset, index) => {
        const actualIndex = startIndex + index;
        return (
          <AssetRow
            key={asset.assetId}
            asset={asset}
            columns={columns}
            isSelected={actualIndex === state.selectedIndex}
          />
        );
      })}
      {Array.from({ length: Math.max(0, visibleRows - visibleAssets.length) }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {state.filteredAssets.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const AssetRow: FC<{
  asset: AssetViewItem;
  columns: Columns<AssetViewItem, 'quantity' | 'symbol'>;
  isSelected: boolean;
}> = ({ asset, columns, isSelected }) => {
  const { symbol, quantity } = columns.format(asset);
  const badge = getAssetBadge(asset);
  const reasonWithHint = getAssetReasonWithHint(asset);

  return (
    <SelectableRow isSelected={isSelected}>
      <Text color="cyan">{symbol}</Text> <Text dimColor>{quantity}</Text>
      {badge && (
        <>
          <Text> </Text>
          <Text color={badge.color}>[{badge.label}]</Text>
        </>
      )}
      {reasonWithHint && (
        <>
          <Text dimColor> · </Text>
          <Text dimColor>{reasonWithHint}</Text>
        </>
      )}
    </SelectableRow>
  );
};

const AssetDetailPanel: FC<{ state: AssetsViewState }> = ({ state }) => {
  const selected = state.filteredAssets[state.selectedIndex];
  if (!selected) {
    return (
      <FixedHeightDetail
        height={ASSET_DETAIL_LINES}
        rows={[<Text key="empty"> </Text>]}
      />
    );
  }

  return (
    <FixedHeightDetail
      height={ASSET_DETAIL_LINES}
      rows={buildAssetDetailRows(selected)}
    />
  );
};

function buildAssetDetailRows(asset: AssetViewItem): ReactElement[] {
  const badge = getAssetBadge(asset);
  const reason = getAssetReason(asset);
  const evidenceRows = buildEvidenceRows(asset);
  const ambiguityContextRows = buildAmbiguityContextRows(asset);

  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {asset.assetSymbols[0] ?? '(unknown)'}</Text> <Text dimColor>{asset.currentQuantity}</Text>
      {badge && (
        <>
          <Text> </Text>
          <Text color={badge.color}>[{badge.label}]</Text>
        </>
      )}
    </Text>,
    <Text key="blank-1"> </Text>,
  ];

  if (asset.assetSymbols.length > 1) {
    rows.push(
      <Text key="symbols">
        {'  '}
        <Text dimColor>Also seen as: </Text>
        <Text>{asset.assetSymbols.join(', ')}</Text>
      </Text>
    );
  }

  rows.push(...ambiguityContextRows);

  if (reason) {
    rows.push(
      <Text key="why">
        {'  '}
        <Text dimColor>Why: </Text>
        <Text>{reason}</Text>
      </Text>
    );
  }

  rows.push(
    <Text key="action">
      {'  '}
      <Text dimColor>Action: </Text>
      <Text>{getActionHint(asset)}</Text>
    </Text>,
    <Text key="seen-in">
      {'  '}
      <Text dimColor>Seen in: </Text>
      <Text>
        {asset.transactionCount} {pluralize(asset.transactionCount, 'transaction')} · {asset.movementCount}{' '}
        {pluralize(asset.movementCount, 'movement')}
      </Text>
    </Text>
  );

  if (evidenceRows.length === 0) {
    return rows;
  }

  const availableEvidenceLines = ASSET_DETAIL_LINES - rows.length - 1;
  rows.push(
    <Text key="signals-header">
      {'  '}
      <Text dimColor>Signals:</Text>
    </Text>
  );

  if (evidenceRows.length <= availableEvidenceLines) {
    rows.push(...evidenceRows);
    return rows;
  }

  const visibleEvidenceRows = Math.max(availableEvidenceLines - 1, 0);
  rows.push(...evidenceRows.slice(0, visibleEvidenceRows));
  rows.push(
    <Text key="signals-overflow">
      {'    '}
      <Text dimColor>... {evidenceRows.length - visibleEvidenceRows} more signal(s)</Text>
    </Text>
  );

  return rows;
}

const AssetsControlsBar: FC<{ state: AssetsViewState }> = ({ state }) => {
  const selected = state.filteredAssets[state.selectedIndex];
  if (!selected) {
    return <Text dimColor>q quit · tab review queue</Text>;
  }

  return (
    <Text dimColor>
      ↑↓/j/k move · tab {state.filter === 'action-required' ? 'main list' : 'review queue'} · x{' '}
      {selected.excluded ? 'include' : 'exclude'}
      {selected.reviewStatus === 'needs-review' && ' · c mark reviewed'}
      {(selected.reviewStatus === 'reviewed' || selected.confirmationIsStale) && ' · u reopen review'} · q quit
    </Text>
  );
};

function getAssetBadge(asset: AssetViewItem): { color: string; label: string } | undefined {
  if (asset.excluded) {
    return {
      color: 'gray',
      label: 'Excluded',
    };
  }

  if (asset.reviewStatus === 'reviewed') {
    return {
      color: 'green',
      label: 'Reviewed',
    };
  }

  if (requiresAssetReviewAction(asset)) {
    return {
      color: 'yellow',
      label: 'Review',
    };
  }

  return undefined;
}

function getAssetReasonWithHint(asset: AssetViewItem): string | undefined {
  const reason = getAssetReason(asset);
  if (!reason) {
    return undefined;
  }

  const extraCategories = countDistinctReasonCategories(asset) - 1;
  if (extraCategories > 0) {
    return `${reason} (+${extraCategories} more)`;
  }

  return reason;
}

function countDistinctReasonCategories(asset: AssetViewItem): number {
  let count = 0;
  if (asset.confirmationIsStale) count++;
  if (asset.evidence.some((item) => item.kind === 'same-symbol-ambiguity')) count++;
  if (
    asset.evidence.some(
      (item) => item.kind === 'provider-spam-flag' || item.kind === 'spam-flag' || item.kind === 'unmatched-reference'
    )
  )
    count++;
  if (asset.evidence.some((item) => item.kind === 'scam-note')) count++;
  if (asset.evidence.some((item) => item.kind === 'suspicious-airdrop-note')) count++;
  return count;
}

function getAssetReason(asset: AssetViewItem): string | undefined {
  if (asset.confirmationIsStale) {
    return 'new signals since your last review';
  }

  if (asset.evidence.some((item) => item.kind === 'same-symbol-ambiguity')) {
    return 'same symbol conflict';
  }

  if (
    asset.evidence.some(
      (item) => item.kind === 'provider-spam-flag' || item.kind === 'spam-flag' || item.kind === 'unmatched-reference'
    )
  ) {
    return 'possible spam';
  }

  if (asset.evidence.some((item) => item.kind === 'scam-note')) {
    return 'scam warnings in imported transactions';
  }

  if (asset.evidence.some((item) => item.kind === 'suspicious-airdrop-note')) {
    return 'suspicious airdrop warnings';
  }

  return undefined;
}

function getActionHint(asset: AssetViewItem): string {
  if (asset.excluded) {
    return 'Press x to include it again.';
  }

  if (asset.confirmationIsStale) {
    return 'Press u to reopen this review.';
  }

  if (asset.reviewStatus === 'needs-review') {
    if (asset.evidence.some((item) => item.kind === 'same-symbol-ambiguity')) {
      return 'Press c to mark reviewed, or x to exclude a conflicting asset.';
    }

    return 'Press c to mark it reviewed, or x to exclude it.';
  }

  if (asset.reviewStatus === 'reviewed') {
    if (asset.accountingBlocked) {
      return 'Press x to exclude a conflicting asset.';
    }

    return 'Press u to reopen this review.';
  }

  return 'Nothing needs your attention right now.';
}

function buildEvidenceRows(asset: AssetViewItem): ReactElement[] {
  return asset.evidence.map((evidence, index) => {
    return (
      <Text key={`signal-${index}`}>
        {'    '}
        <Text color={evidence.severity === 'error' ? 'red' : 'yellow'}>•</Text> {formatEvidenceMessage(evidence.kind)}
      </Text>
    );
  });
}

function buildAmbiguityContextRows(asset: AssetViewItem): ReactElement[] {
  const ambiguityEvidence = asset.evidence.find((item) => item.kind === 'same-symbol-ambiguity');
  if (!ambiguityEvidence) {
    return [];
  }

  const tokenIdentity = getBlockchainTokenIdentity(asset.assetId);
  if (!tokenIdentity) {
    return [];
  }

  const rows: ReactElement[] = [
    <Text
      key="contract"
      wrap="wrap"
    >
      {'  '}
      <Text dimColor>Contract: </Text>
      <Text>
        {tokenIdentity.chain} {tokenIdentity.ref}
      </Text>
    </Text>,
    <Text key="coingecko">
      {'  '}
      <Text dimColor>CoinGecko: </Text>
      <Text>{formatCoinGeckoReferenceStatus(asset.referenceStatus)}</Text>
    </Text>,
  ];

  const conflictingContracts = getConflictingContracts(ambiguityEvidence.metadata, asset.assetId);
  if (conflictingContracts.length > 0) {
    rows.push(
      ...conflictingContracts.map((contract, index) => (
        <Text
          key={`conflict-${index}`}
          wrap="wrap"
        >
          {'  '}
          <Text dimColor>Conflict: </Text>
          <Text>{contract}</Text>
        </Text>
      ))
    );
  }

  return rows;
}

function formatEvidenceMessage(kind: AssetViewItem['evidence'][number]['kind']): string {
  switch (kind) {
    case 'provider-spam-flag':
      return 'A provider marked this token as spam.';
    case 'spam-flag':
      return 'Imported transactions marked this asset as spam.';
    case 'unmatched-reference':
      return 'Canonical reference lookup could not match this token.';
    case 'scam-note':
      return 'Imported transactions include scam warnings.';
    case 'suspicious-airdrop-note':
      return 'Imported transactions include suspicious airdrop warnings.';
    case 'same-symbol-ambiguity':
      return 'The same symbol appears on the same chain in multiple assets.';
    default:
      return 'Review details are available for this asset.';
  }
}

function pluralize(count: number, label: string): string {
  return count === 1 ? label : `${label}s`;
}

function getBlockchainTokenIdentity(assetId: string): { chain: string; ref: string } | undefined {
  const parsedAssetId = parseAssetId(assetId);
  if (parsedAssetId.isErr() || parsedAssetId.value.namespace !== 'blockchain' || !parsedAssetId.value.chain) {
    return undefined;
  }

  const ref = parsedAssetId.value.ref;
  if (!ref || ref === 'native') {
    return undefined;
  }

  return {
    chain: parsedAssetId.value.chain,
    ref,
  };
}

function getConflictingContracts(
  metadata: AssetViewItem['evidence'][number]['metadata'],
  currentAssetId: string
): string[] {
  const conflictingAssetIds = metadata?.['conflictingAssetIds'];
  if (!Array.isArray(conflictingAssetIds)) {
    return [];
  }

  return conflictingAssetIds
    .filter((assetId): assetId is string => typeof assetId === 'string' && assetId !== currentAssetId)
    .map((assetId) => {
      const identity = getBlockchainTokenIdentity(assetId);
      return identity?.ref ?? assetId;
    });
}

function formatCoinGeckoReferenceStatus(referenceStatus: AssetViewItem['referenceStatus']): string {
  switch (referenceStatus) {
    case 'matched':
      return 'matched canonical token';
    case 'unmatched':
      return 'no canonical match';
    default:
      return 'no lookup result';
  }
}
