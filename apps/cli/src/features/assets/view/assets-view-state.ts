import { requiresAssetReviewAction } from '../asset-view-filter.js';
import type { AssetViewItem } from '../command/assets-types.js';

export type AssetsViewFilter = 'default' | 'action-required';

export interface AssetsViewState {
  actionRequiredCount: number;
  assets: AssetViewItem[];
  error?: string | undefined;
  excludedCount: number;
  filter: AssetsViewFilter;
  filteredAssets: AssetViewItem[];
  pinnedAssetId?: string | undefined;
  pendingAction?:
    | {
        assetId: string;
        type: 'clear-review' | 'confirm-review' | 'toggle-exclusion';
      }
    | undefined;
  scrollOffset: number;
  selectedIndex: number;
  statusMessage?: string | undefined;
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
  initialFilter: AssetsViewFilter = 'default',
  initialSelectedAssetId?: string
): AssetsViewState {
  const filteredAssets = applyFilter(assets, initialFilter, initialSelectedAssetId);
  const selectedIndex =
    initialSelectedAssetId === undefined
      ? 0
      : Math.max(
          0,
          filteredAssets.findIndex((asset) => asset.assetId === initialSelectedAssetId)
        );

  return {
    assets,
    filteredAssets,
    filter: initialFilter,
    selectedIndex,
    scrollOffset: 0,
    pendingAction: undefined,
    error: undefined,
    totalCount: counts.totalCount,
    excludedCount: counts.excludedCount,
    actionRequiredCount: counts.actionRequiredCount,
    pinnedAssetId: initialSelectedAssetId,
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

export function applyFilter(
  assets: AssetViewItem[],
  filter: AssetsViewFilter,
  pinnedAssetId?: string
): AssetViewItem[] {
  const filteredAssets =
    filter === 'action-required'
      ? assets.filter(requiresAssetReviewAction)
      : assets.filter((asset) => asset.currentQuantity !== '0' || asset.excluded || requiresAssetReviewAction(asset));

  if (
    filter !== 'default' ||
    pinnedAssetId === undefined ||
    filteredAssets.some((asset) => asset.assetId === pinnedAssetId)
  ) {
    return filteredAssets;
  }

  const pinnedAsset = assets.find((asset) => asset.assetId === pinnedAssetId);
  return pinnedAsset ? [pinnedAsset, ...filteredAssets] : filteredAssets;
}
