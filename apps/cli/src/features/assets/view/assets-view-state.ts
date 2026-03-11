import type { AssetReviewStatus } from '@exitbook/core';

import type { AssetViewItem } from '../command/assets-handler.js';

export type AssetsViewFilter = 'all' | 'needs-review';

export interface AssetsViewState {
  assets: AssetViewItem[];
  error?: string | undefined;
  excludedCount: number;
  filter: AssetsViewFilter;
  filteredAssets: AssetViewItem[];
  needsReviewCount: number;
  pendingAction?:
    | {
        assetId: string;
        type: 'clear-review' | 'confirm-review' | 'toggle-exclusion';
      }
    | undefined;
  scrollOffset: number;
  selectedIndex: number;
  totalCount: number;
}

export function createAssetsViewState(
  assets: AssetViewItem[],
  counts: { excludedCount: number; needsReviewCount: number; totalCount: number },
  initialFilter: AssetsViewFilter = 'all'
): AssetsViewState {
  const filteredAssets = applyFilter(assets, initialFilter);

  return {
    assets,
    filteredAssets,
    filter: initialFilter,
    selectedIndex: 0,
    scrollOffset: 0,
    pendingAction: undefined,
    error: undefined,
    totalCount: counts.totalCount,
    excludedCount: counts.excludedCount,
    needsReviewCount: counts.needsReviewCount,
  };
}

export function applyAssetViewMutation(
  assets: AssetViewItem[],
  mutation:
    | { assetId: string; excluded: boolean; type: 'toggle-exclusion' }
    | { assetId: string; type: 'confirm-review' }
    | { assetId: string; reviewState: AssetReviewStatus; type: 'clear-review' }
): AssetViewItem[] {
  return assets.map((asset) => {
    if (asset.assetId !== mutation.assetId) {
      return asset;
    }

    if (mutation.type === 'toggle-exclusion') {
      return {
        ...asset,
        excluded: mutation.excluded,
      };
    }

    if (mutation.type === 'confirm-review') {
      return {
        ...asset,
        reviewState: 'reviewed',
        confirmationIsStale: false,
      };
    }

    return {
      ...asset,
      reviewState: mutation.reviewState,
      confirmationIsStale: false,
    };
  });
}

export function applyFilter(assets: AssetViewItem[], filter: AssetsViewFilter): AssetViewItem[] {
  if (filter === 'needs-review') {
    return assets.filter((asset) => asset.reviewState === 'needs-review');
  }

  return assets;
}
