import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useReducer, type FC, type ReactElement } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  Divider,
  FixedHeightDetail,
  SelectableRow,
} from '../../../ui/shared/index.js';
import type { AssetReviewOverrideResult, AssetOverrideResult, AssetViewItem } from '../command/assets-handler.js';

import { assetsViewReducer, handleAssetsKeyboardInput } from './assets-view-controller.js';
import type { AssetsViewState } from './assets-view-state.js';

const ASSET_DETAIL_LINES = 12;

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
        .then(() => {
          dispatch({
            type: 'CONFIRM_REVIEW_SUCCESS',
            assetId: selected.assetId,
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
          reviewState: result.reviewState,
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
  return (
    <Box>
      <Text bold>Assets</Text>
      <Text> </Text>
      <Text>{state.totalCount} total</Text>
      <Text dimColor> · </Text>
      <Text color="yellow">{state.needsReviewCount} needs review</Text>
      <Text dimColor> · </Text>
      <Text dimColor>{state.excludedCount} excluded</Text>
      <Text dimColor> · </Text>
      <Text dimColor>filter: {state.filter}</Text>
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
    return <Text dimColor>{state.filter === 'needs-review' ? 'No assets need review.' : 'No assets found.'}</Text>;
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
  return (
    <SelectableRow isSelected={isSelected}>
      <Text color={getReviewColor(asset.reviewState)}>{formatReviewBadge(asset)}</Text>{' '}
      <Text color="cyan">{primarySymbol}</Text> <Text dimColor>{asset.currentQuantity}</Text>{' '}
      <Text dimColor>{formatReferenceStatus(asset.referenceStatus)}</Text>{' '}
      <Text dimColor>{asset.excluded ? 'excluded' : 'included'}</Text>
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
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {asset.assetSymbols[0] ?? '(unknown)'}</Text> <Text dimColor>{asset.assetId}</Text>
    </Text>,
    <Text key="blank-1"> </Text>,
    <Text key="symbols">
      {'  '}
      <Text dimColor>Symbols: </Text>
      <Text>{asset.assetSymbols.join(', ') || '(unknown)'}</Text>
    </Text>,
    <Text key="quantity">
      {'  '}
      <Text dimColor>Quantity: </Text>
      <Text>{asset.currentQuantity}</Text>
    </Text>,
    <Text key="review">
      {'  '}
      <Text dimColor>Review: </Text>
      <Text color={getReviewColor(asset.reviewState)}>{formatReviewBadge(asset)}</Text>
    </Text>,
    <Text key="reference">
      {'  '}
      <Text dimColor>Reference: </Text>
      <Text>{formatReferenceStatus(asset.referenceStatus)}</Text>
    </Text>,
    <Text key="policy">
      {'  '}
      <Text dimColor>Accounting: </Text>
      <Text>{asset.accountingBlocked ? 'blocked' : 'allowed'}</Text>
    </Text>,
    <Text key="exclusion">
      {'  '}
      <Text dimColor>Exclusion: </Text>
      <Text>{asset.excluded ? 'excluded' : 'included'}</Text>
    </Text>,
    <Text key="summary">
      {'  '}
      <Text dimColor>Summary: </Text>
      <Text>{asset.reviewSummary ?? 'No review warnings'}</Text>
    </Text>,
  ];

  if (asset.evidence.length === 0) {
    rows.push(
      <Text key="evidence-none">
        {'  '}
        <Text dimColor>Evidence: </Text>
        <Text>No review evidence</Text>
      </Text>
    );
    return rows;
  }

  const flattenedEvidenceRows: ReactElement[] = [];
  for (const [index, evidence] of asset.evidence.entries()) {
    flattenedEvidenceRows.push(
      <Text key={`evidence-${index}`}>
        {'    '}
        <Text color={evidence.severity === 'error' ? 'red' : 'yellow'}>[{evidence.severity}]</Text> {evidence.message}
      </Text>
    );

    const conflictingAssetIds = readConflictingAssetIds(evidence.metadata);
    if (conflictingAssetIds) {
      flattenedEvidenceRows.push(
        <Text key={`evidence-conflicts-${index}`}>
          {'      '}
          <Text dimColor>Conflicts: </Text>
          <Text>{conflictingAssetIds.join(', ')}</Text>
        </Text>
      );
    }
  }

  const availableEvidenceLines = ASSET_DETAIL_LINES - rows.length - 1;
  rows.push(
    <Text key="evidence-header">
      {'  '}
      <Text dimColor>Evidence:</Text>
    </Text>
  );

  if (flattenedEvidenceRows.length <= availableEvidenceLines) {
    rows.push(...flattenedEvidenceRows);
    return rows;
  }

  const visibleEvidenceRows = Math.max(availableEvidenceLines - 1, 0);
  rows.push(...flattenedEvidenceRows.slice(0, visibleEvidenceRows));
  rows.push(
    <Text key="evidence-overflow">
      {'    '}
      <Text dimColor>... {flattenedEvidenceRows.length - visibleEvidenceRows} more evidence row(s)</Text>
    </Text>
  );

  return rows;
}

const AssetsControlsBar: FC<{ state: AssetsViewState }> = ({ state }) => {
  const selected = state.filteredAssets[state.selectedIndex];
  if (!selected) {
    return <Text dimColor>q quit · tab filter</Text>;
  }

  return (
    <Text dimColor>
      ↑↓/j/k move · tab filter · x {selected.excluded ? 'include' : 'exclude'}
      {selected.reviewState === 'needs-review' && ' · c confirm'}
      {(selected.reviewState === 'reviewed' || selected.confirmationIsStale) && ' · u clear review'} · q quit
    </Text>
  );
};

function formatReviewBadge(asset: AssetViewItem): string {
  if (asset.reviewState === 'reviewed') {
    return '[reviewed]';
  }
  if (asset.reviewState === 'needs-review') {
    return asset.confirmationIsStale ? '[stale]' : '[review]';
  }
  return '[clear]';
}

function getReviewColor(reviewState: AssetViewItem['reviewState']): string {
  switch (reviewState) {
    case 'needs-review':
      return 'yellow';
    case 'reviewed':
      return 'green';
    default:
      return 'gray';
  }
}

function formatReferenceStatus(status: AssetViewItem['referenceStatus']): string {
  switch (status) {
    case 'matched':
      return 'reference matched';
    case 'unmatched':
      return 'reference unmatched';
    default:
      return 'reference unknown';
  }
}

function readConflictingAssetIds(metadata: Record<string, unknown> | undefined): string[] | undefined {
  const value = metadata?.['conflictingAssetIds'];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const assetIds = value.filter((item): item is string => typeof item === 'string');
  return assetIds.length > 0 ? assetIds : undefined;
}
