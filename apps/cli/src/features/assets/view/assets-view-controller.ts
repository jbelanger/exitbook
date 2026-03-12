import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';
import { end, home, navigateDown, navigateUp, pageDown, pageUp } from '../../../ui/shared/list-navigation.js';
import { requiresAssetReviewAction } from '../asset-view-filter.js';
import type { AssetViewItem } from '../command/assets-handler.js';

import { ASSETS_CHROME_LINES } from './assets-view-components.jsx';
import {
  applyAssetViewMutation,
  applyFilter,
  type AssetReviewViewMutation,
  type AssetsViewFilter,
  type AssetsViewState,
} from './assets-view-state.js';

export type AssetsViewAction =
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }
  | { type: 'CYCLE_FILTER' }
  | { type: 'TOGGLE_EXCLUSION' }
  | { type: 'CONFIRM_REVIEW' }
  | { type: 'CLEAR_REVIEW' }
  | { assetId: string; excluded: boolean; type: 'TOGGLE_EXCLUSION_SUCCESS' }
  | { assetId: string; review: AssetReviewViewMutation; type: 'CONFIRM_REVIEW_SUCCESS' }
  | { assetId: string; review: AssetReviewViewMutation; type: 'CLEAR_REVIEW_SUCCESS' }
  | { error: string; type: 'SET_ERROR' };

export function assetsViewReducer(state: AssetsViewState, action: AssetsViewAction): AssetsViewState {
  const itemCount = state.filteredAssets.length;
  const buildContext = (visibleRows: number) => ({
    itemCount,
    visibleRows,
    wrapAround: true,
  });

  switch (action.type) {
    case 'NAVIGATE_UP': {
      const next = navigateUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next, error: undefined };
    }

    case 'NAVIGATE_DOWN': {
      const next = navigateDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next, error: undefined };
    }

    case 'PAGE_UP': {
      const next = pageUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next, error: undefined };
    }

    case 'PAGE_DOWN': {
      const next = pageDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next, error: undefined };
    }

    case 'HOME':
      return { ...state, ...home(), error: undefined };

    case 'END':
      return { ...state, ...end(buildContext(action.visibleRows)), error: undefined };

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
      };
    }

    case 'TOGGLE_EXCLUSION_SUCCESS': {
      const assets = applyAssetViewMutation(state.assets, {
        type: 'toggle-exclusion',
        assetId: action.assetId,
        excluded: action.excluded,
      });
      return rebuildStateAfterMutation(state, assets);
    }

    case 'CONFIRM_REVIEW_SUCCESS': {
      const assets = applyAssetViewMutation(state.assets, {
        type: 'update-review',
        assetId: action.assetId,
        review: action.review,
      });
      return rebuildStateAfterMutation(state, assets);
    }

    case 'CLEAR_REVIEW_SUCCESS': {
      const assets = applyAssetViewMutation(state.assets, {
        type: 'update-review',
        assetId: action.assetId,
        review: action.review,
      });
      return rebuildStateAfterMutation(state, assets);
    }

    case 'SET_ERROR':
      return {
        ...state,
        pendingAction: undefined,
        error: action.error,
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
  terminalHeight: number
): void {
  const visibleRows = calculateVisibleRows(terminalHeight, ASSETS_CHROME_LINES);

  if (input === 'q' || key.escape) {
    onQuit();
    return;
  }

  if (key.tab) {
    dispatch({ type: 'CYCLE_FILTER' });
    return;
  }

  if (key.upArrow || input === 'k') {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return;
  }

  if (key.downArrow || input === 'j') {
    dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
    return;
  }

  if (key.pageUp || (key.ctrl && input === 'u')) {
    dispatch({ type: 'PAGE_UP', visibleRows });
    return;
  }

  if (key.pageDown || (key.ctrl && input === 'd')) {
    dispatch({ type: 'PAGE_DOWN', visibleRows });
    return;
  }

  if (key.home) {
    dispatch({ type: 'HOME' });
    return;
  }

  if (key.end) {
    dispatch({ type: 'END', visibleRows });
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

function rebuildStateAfterMutation(state: AssetsViewState, assets: AssetViewItem[]): AssetsViewState {
  const filteredAssets = applyFilter(assets, state.filter);
  const maxIndex = Math.max(0, filteredAssets.length - 1);
  const selectedIndex = Math.min(state.selectedIndex, maxIndex);
  const scrollOffset = Math.min(state.scrollOffset, selectedIndex);

  return {
    ...state,
    assets,
    filteredAssets,
    selectedIndex,
    scrollOffset,
    pendingAction: undefined,
    error: undefined,
    excludedCount: assets.filter((asset) => asset.excluded).length,
    actionRequiredCount: assets.filter(requiresAssetReviewAction).length,
    totalCount: assets.length,
  };
}
