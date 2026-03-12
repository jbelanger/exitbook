import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useReducer, type FC, type ReactElement } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  Divider,
  FixedHeightDetail,
  SelectableRow,
} from '../../../ui/shared/index.js';
import { requiresAssetReviewAction } from '../asset-view-filter.js';
import type { AssetReviewOverrideResult, AssetOverrideResult, AssetViewItem } from '../command/assets-handler.js';

import { assetsViewReducer, handleAssetsKeyboardInput } from './assets-view-controller.js';
import type { AssetsViewState } from './assets-view-state.js';

const ASSET_DETAIL_LINES = 13;

export const ASSETS_CHROME_LINES = calculateChromeLines({
  beforeHeader: 1,
  header: 1,
  afterHeader: 1,
  listScrollIndicators: 2,
  divider: 1,
  detail: ASSET_DETAIL_LINES,
  beforeControls: 1,
  controls: 1,
  buffer: 1,
});

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
    handleAssetsKeyboardInput(input, key, dispatch, onQuit, terminalHeight);
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

  return (
    <Box>
      <Text bold>Assets</Text>
      <Text> </Text>
      <Text>{state.filteredAssets.length} shown</Text>
      <Text dimColor> · </Text>
      <Text color="yellow">{flaggedLabel}</Text>
      <Text dimColor> · </Text>
      <Text dimColor>{excludedLabel}</Text>
    </Box>
  );
};

const AssetList: FC<{ state: AssetsViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const visibleRows = calculateVisibleRows(terminalHeight, ASSETS_CHROME_LINES);
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
            isSelected={actualIndex === state.selectedIndex}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {state.filteredAssets.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

const AssetRow: FC<{ asset: AssetViewItem; isSelected: boolean }> = ({ asset, isSelected }) => {
  const primarySymbol = asset.assetSymbols[0] ?? '(unknown)';
  const badge = getAssetBadge(asset);
  const reason = getAssetReason(asset);

  return (
    <SelectableRow isSelected={isSelected}>
      <Text color="cyan">{primarySymbol}</Text> <Text dimColor>{asset.currentQuantity}</Text>
      {badge && (
        <>
          <Text> </Text>
          <Text color={badge.color}>[{badge.label}]</Text>
        </>
      )}
      {reason && (
        <>
          <Text dimColor> · </Text>
          <Text dimColor>{reason}</Text>
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
    <Text key="quantity">
      {'  '}
      <Text dimColor>Quantity: </Text>
      <Text>{asset.currentQuantity}</Text>
    </Text>,
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
    rows.push(
      <Text key="signals-none">
        {'  '}
        <Text dimColor>Signals: </Text>
        <Text>None</Text>
      </Text>
    );
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

  if (requiresAssetReviewAction(asset)) {
    return {
      color: 'yellow',
      label: 'Review',
    };
  }

  if (asset.reviewStatus === 'reviewed') {
    return {
      color: 'green',
      label: 'Reviewed',
    };
  }

  return undefined;
}

function getAssetReason(asset: AssetViewItem): string | undefined {
  if (asset.confirmationIsStale) {
    return 'new signals since your last review';
  }

  if (asset.evidence.some((item) => item.kind === 'same-symbol-ambiguity')) {
    return 'same symbol conflict';
  }

  if (asset.evidence.some((item) => item.kind === 'provider-spam-flag' || item.kind === 'spam-flag')) {
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
      return 'Press c to keep it, or x to exclude a conflicting asset.';
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

function formatEvidenceMessage(kind: AssetViewItem['evidence'][number]['kind']): string {
  switch (kind) {
    case 'provider-spam-flag':
      return 'A provider marked this token as spam.';
    case 'spam-flag':
      return 'Imported transactions marked this asset as spam.';
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
