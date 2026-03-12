import { requiresAssetReviewAction } from '../asset-view-filter.js';
import type { AssetViewItem } from '../command/assets-handler.js';

export type AssetsViewFilter = 'default' | 'action-required';

export interface AssetsViewState {
  actionRequiredCount: number;
  assets: AssetViewItem[];
  error?: string | undefined;
  excludedCount: number;
  filter: AssetsViewFilter;
  filteredAssets: AssetViewItem[];
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

export type AssetReviewViewMutation = Pick<
  AssetViewItem,
  | 'accountingBlocked'
  | 'confirmationIsStale'
  | 'evidence'
  | 'evidenceFingerprint'
  | 'referenceStatus'
  | 'reviewStatus'
  | 'warningSummary'
>;

export function createAssetsViewState(
  assets: AssetViewItem[],
  counts: { actionRequiredCount: number; excludedCount: number; totalCount: number },
  initialFilter: AssetsViewFilter = 'default'
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
    actionRequiredCount: counts.actionRequiredCount,
  };
}

export function applyAssetViewMutation(
  assets: AssetViewItem[],
  mutation:
    | { assetId: string; excluded: boolean; type: 'toggle-exclusion' }
    | { assetId: string; review: AssetReviewViewMutation; type: 'update-review' }
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

    return {
      ...asset,
      ...mutation.review,
    };
  });
}

export function applyFilter(assets: AssetViewItem[], filter: AssetsViewFilter): AssetViewItem[] {
  if (filter === 'action-required') {
    return assets.filter(requiresAssetReviewAction);
  }

  return assets.filter((asset) => asset.currentQuantity !== '0' || asset.excluded || requiresAssetReviewAction(asset));
}
