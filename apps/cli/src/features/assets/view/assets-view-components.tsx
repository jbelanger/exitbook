import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useReducer, type FC, type ReactElement } from 'react';

import { type Columns, createColumns, Divider, FixedHeightDetail, SelectableRow } from '../../../ui/shared/index.js';
import type { AssetReviewOverrideResult, AssetOverrideResult, AssetViewItem } from '../command/assets-types.js';

import { assetsViewReducer, handleAssetsKeyboardInput } from './assets-view-controller.js';
import {
  formatAssetCoinGeckoReferenceStatus,
  formatAssetEvidenceMessage,
  getAssetBadge,
  getAssetBlockchainTokenIdentity,
  getAssetReason,
  getAssetReasonWithHint,
  getConflictingAssetIds,
  getPrimaryAssetSymbol,
  getAssetTransactionInspectionHint,
  getAssetTuiActionHint,
  pluralizeAssetLabel,
} from './assets-view-formatters.js';
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
        <Text dimColor> </Text>
        <Text color="yellow">
          {state.filteredAssets.length} flagged {pluralizeAssetLabel(state.filteredAssets.length, 'asset')}
        </Text>
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
      <Text dimColor> </Text>
      <Text dimColor>{countLabel}</Text>
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
    symbol: { format: (item) => getPrimaryAssetSymbol(item), minWidth: 4 },
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
  const transactionInspectionHint = getAssetTransactionInspectionHint(asset);

  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {getPrimaryAssetSymbol(asset)}</Text> <Text dimColor>{asset.currentQuantity}</Text>
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
      <Text>{getAssetTuiActionHint(asset)}</Text>
    </Text>,
    ...(transactionInspectionHint
      ? [
          <Text
            key="inspect"
            wrap="wrap"
          >
            {'  '}
            <Text dimColor>Inspect: </Text>
            <Text>{transactionInspectionHint}</Text>
          </Text>,
        ]
      : []),
    <Text key="seen-in">
      {'  '}
      <Text dimColor>Seen in: </Text>
      <Text>
        {asset.transactionCount} {pluralizeAssetLabel(asset.transactionCount, 'transaction')} · {asset.movementCount}{' '}
        {pluralizeAssetLabel(asset.movementCount, 'movement')}
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

function buildEvidenceRows(asset: AssetViewItem): ReactElement[] {
  return asset.evidence.map((evidence, index) => {
    return (
      <Text key={`signal-${index}`}>
        {'    '}
        <Text color={evidence.severity === 'error' ? 'red' : 'yellow'}>•</Text>{' '}
        {formatAssetEvidenceMessage(evidence.kind)}
      </Text>
    );
  });
}

function buildAmbiguityContextRows(asset: AssetViewItem): ReactElement[] {
  const ambiguityEvidence = asset.evidence.find((item) => item.kind === 'same-symbol-ambiguity');
  if (!ambiguityEvidence) {
    return [];
  }

  const tokenIdentity = getAssetBlockchainTokenIdentity(asset.assetId);
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
      <Text>{formatAssetCoinGeckoReferenceStatus(asset.referenceStatus)}</Text>
    </Text>,
  ];

  const conflictingAssetIds = getConflictingAssetIds(ambiguityEvidence.metadata, asset.assetId);
  if (conflictingAssetIds.length > 0) {
    rows.push(
      ...conflictingAssetIds.map((conflictingAssetId, index) => (
        <Text
          key={`conflict-${index}`}
          wrap="wrap"
        >
          {'  '}
          <Text dimColor>Conflict asset: </Text>
          <Text>{conflictingAssetId}</Text>
        </Text>
      ))
    );
  }

  return rows;
}
