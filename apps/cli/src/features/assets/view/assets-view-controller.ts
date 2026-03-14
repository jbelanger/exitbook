import {
  dispatchListNavigationKeys,
  isListNavigationAction,
  type ListNavigationAction,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';
import { requiresAssetReviewAction } from '../asset-view-filter.js';
import type { AssetViewItem } from '../command/assets-handler.js';

import { getAssetsVisibleRows } from './assets-view-layout.js';
import {
  applyAssetViewMutation,
  applyFilter,
  type AssetReviewViewMutation,
  type AssetsViewFilter,
  type AssetsViewState,
} from './assets-view-state.js';

export type AssetsViewAction =
  | ListNavigationAction
  | { type: 'CYCLE_FILTER' }
  | { type: 'TOGGLE_EXCLUSION' }
  | { type: 'CONFIRM_REVIEW' }
  | { type: 'CLEAR_REVIEW' }
  | { assetId: string; excluded: boolean; type: 'TOGGLE_EXCLUSION_SUCCESS' }
  | { assetId: string; review: AssetReviewViewMutation; type: 'CONFIRM_REVIEW_SUCCESS' }
  | { assetId: string; review: AssetReviewViewMutation; type: 'CLEAR_REVIEW_SUCCESS' }
  | { error: string; type: 'SET_ERROR' };

export function assetsViewReducer(state: AssetsViewState, action: AssetsViewAction): AssetsViewState {
  if (isListNavigationAction(action)) {
    const nav = reduceListNavigation(
      { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
      action,
      state.filteredAssets.length
    );
    return { ...state, ...nav, error: undefined, statusMessage: undefined };
  }

  switch (action.type) {
    case 'CYCLE_FILTER': {
      const nextFilter: AssetsViewFilter = state.filter === 'default' ? 'action-required' : 'default';
      const filteredAssets = applyFilter(state.assets, nextFilter);
      return {
        ...state,
        filter: nextFilter,
        filteredAssets,
        selectedIndex: 0,
        scrollOffset: 0,
        error: undefined,
        statusMessage: undefined,
      };
    }

    case 'TOGGLE_EXCLUSION': {
      const selected = state.filteredAssets[state.selectedIndex];
      if (!selected) {
        return state;
      }

      return {
        ...state,
        pendingAction: {
          type: 'toggle-exclusion',
          assetId: selected.assetId,
        },
        error: undefined,
        statusMessage: undefined,
      };
    }

    case 'CONFIRM_REVIEW': {
      const selected = state.filteredAssets[state.selectedIndex];
      if (!selected) {
        return state;
      }

      if (selected.reviewStatus !== 'needs-review') {
        return {
          ...state,
          error: 'Selected asset does not currently need review',
        };
      }

      return {
        ...state,
        pendingAction: {
          type: 'confirm-review',
          assetId: selected.assetId,
        },
        error: undefined,
        statusMessage: undefined,
      };
    }

    case 'CLEAR_REVIEW': {
      const selected = state.filteredAssets[state.selectedIndex];
      if (!selected) {
        return state;
      }

      if (selected.reviewStatus !== 'reviewed' && !selected.confirmationIsStale) {
        return {
          ...state,
          error: 'Selected asset does not have a review confirmation to clear',
        };
      }

      return {
        ...state,
        pendingAction: {
          type: 'clear-review',
          assetId: selected.assetId,
        },
        error: undefined,
        statusMessage: undefined,
      };
    }

    case 'TOGGLE_EXCLUSION_SUCCESS': {
      const assets = applyAssetViewMutation(state.assets, {
        type: 'toggle-exclusion',
        assetId: action.assetId,
        excluded: action.excluded,
      });
      return rebuildStateAfterMutation(state, assets, action.excluded ? 'Excluded' : 'Included');
    }

    case 'CONFIRM_REVIEW_SUCCESS': {
      const assets = applyAssetViewMutation(state.assets, {
        type: 'update-review',
        assetId: action.assetId,
        review: action.review,
      });
      const message = action.review.accountingBlocked
        ? 'Marked as reviewed — exclude a conflicting asset to unblock'
        : 'Marked as reviewed';
      return rebuildStateAfterMutation(state, assets, message, action.assetId);
    }

    case 'CLEAR_REVIEW_SUCCESS': {
      const assets = applyAssetViewMutation(state.assets, {
        type: 'update-review',
        assetId: action.assetId,
        review: action.review,
      });
      return rebuildStateAfterMutation(state, assets, 'Review reopened', action.assetId);
    }

    case 'SET_ERROR':
      return {
        ...state,
        pendingAction: undefined,
        error: action.error,
        statusMessage: undefined,
      };

    default:
      return state;
  }
}

export function handleAssetsKeyboardInput(
  input: string,
  key: {
    ctrl: boolean;
    downArrow: boolean;
    end: boolean;
    escape: boolean;
    home: boolean;
    pageDown: boolean;
    pageUp: boolean;
    tab: boolean;
    upArrow: boolean;
  },
  dispatch: (action: AssetsViewAction) => void,
  onQuit: () => void,
  terminalHeight: number,
  state: Pick<AssetsViewState, 'error' | 'statusMessage'>
): void {
  const visibleRows = getAssetsVisibleRows(
    terminalHeight,
    state.error !== undefined || state.statusMessage !== undefined
  );

  if (input === 'q' || key.escape) {
    onQuit();
    return;
  }

  if (key.tab) {
    dispatch({ type: 'CYCLE_FILTER' });
    return;
  }

  if (dispatchListNavigationKeys(key, input, dispatch, visibleRows)) {
    return;
  }

  if (input === 'x') {
    dispatch({ type: 'TOGGLE_EXCLUSION' });
    return;
  }

  if (input === 'c') {
    dispatch({ type: 'CONFIRM_REVIEW' });
    return;
  }

  if (input === 'u') {
    dispatch({ type: 'CLEAR_REVIEW' });
  }
}

function rebuildStateAfterMutation(
  state: AssetsViewState,
  assets: AssetViewItem[],
  statusMessage?: string,
  mutatedAssetId?: string
): AssetsViewState {
  const filteredAssets = buildFilteredAssetsAfterMutation(assets, state.filter, mutatedAssetId);

  const selectedAssetIndex =
    mutatedAssetId === undefined ? -1 : filteredAssets.findIndex((asset) => asset.assetId === mutatedAssetId);
  const maxIndex = Math.max(0, filteredAssets.length - 1);
  const selectedIndex = selectedAssetIndex >= 0 ? selectedAssetIndex : Math.min(state.selectedIndex, maxIndex);
  const scrollOffset = Math.min(state.scrollOffset, selectedIndex);

  return {
    ...state,
    assets,
    filteredAssets,
    selectedIndex,
    scrollOffset,
    pendingAction: undefined,
    error: undefined,
    statusMessage,
    excludedCount: assets.filter((asset) => asset.excluded).length,
    actionRequiredCount: assets.filter(requiresAssetReviewAction).length,
    totalCount: assets.length,
  };
}

function buildFilteredAssetsAfterMutation(
  assets: AssetViewItem[],
  filter: AssetsViewFilter,
  mutatedAssetId?: string
): AssetViewItem[] {
  const filteredAssets = applyFilter(assets, filter);
  if (filter !== 'default' || mutatedAssetId === undefined) {
    return filteredAssets;
  }

  const mutatedAsset = assets.find((asset) => asset.assetId === mutatedAssetId);
  if (!mutatedAsset || filteredAssets.some((asset) => asset.assetId === mutatedAssetId)) {
    return filteredAssets;
  }

  // Keep the just-updated asset visible in the default list so the user can immediately undo or continue acting on it.
  return [mutatedAsset, ...filteredAssets];
}
