import type {
  AssetReviewEvidence,
  AssetReviewStatus,
  AssetReviewSummary,
  BalanceSnapshotAsset,
  Transaction,
} from '@exitbook/core';
import type { AssetReviewDecision } from '@exitbook/data/overrides';
import type { AssetReferenceStatus } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

import type { KnownAssetRecord } from './assets-utils.js';

export interface AssetSelectionParams {
  assetId?: string | undefined;
  symbol?: string | undefined;
}

export interface AssetOverrideParams extends AssetSelectionParams {
  profileId: number;
  profileKey: string;
  reason?: string | undefined;
}

export interface ViewAssetsParams {
  actionRequiredOnly?: boolean | undefined;
  profileId: number;
  profileKey: string;
}

export interface BrowseAssetsParams extends ViewAssetsParams {
  selector?: string | undefined;
}

export interface AssetOverrideResult {
  action: 'exclude' | 'include';
  assetId: string;
  assetSymbols: string[];
  changed: boolean;
  reason?: string | undefined;
}

export interface AssetReviewOverrideResult {
  action: 'clear-review' | 'confirm';
  accountingBlocked: boolean;
  assetId: string;
  assetSymbols: string[];
  changed: boolean;
  confirmationIsStale: boolean;
  evidence: AssetReviewEvidence[];
  evidenceFingerprint: string;
  referenceStatus: AssetReferenceStatus;
  reason?: string | undefined;
  reviewStatus: AssetReviewStatus;
  warningSummary?: string | undefined;
}

export interface ExcludedAssetSummary {
  assetId: string;
  assetSymbols: string[];
  movementCount: number;
  transactionCount: number;
}

export interface AssetExclusionsResult {
  excludedAssets: ExcludedAssetSummary[];
}

export interface AssetViewItem {
  assetId: string;
  assetSymbols: string[];
  accountingBlocked: boolean;
  confirmationIsStale: boolean;
  currentQuantity: string;
  evidence: AssetReviewEvidence[];
  evidenceFingerprint?: string | undefined;
  excluded: boolean;
  movementCount: number;
  referenceStatus: AssetReferenceStatus;
  reviewStatus: AssetReviewStatus;
  warningSummary?: string | undefined;
  transactionCount: number;
}

export interface AssetsViewResult {
  actionRequiredCount: number;
  assets: AssetViewItem[];
  excludedCount: number;
  totalCount: number;
}

export interface AssetsBrowseResult extends AssetsViewResult {
  allAssets: AssetViewItem[];
  selectedAsset?: AssetViewItem | undefined;
}

export interface AssetSnapshot {
  currentHoldings: Map<string, { assetSymbols: string[]; currentQuantity: string }>;
  excludedAssetIds: Set<string>;
  knownAssets: Map<string, KnownAssetRecord>;
  reviewDecisions: Map<string, AssetReviewDecision>;
  reviewSummaries: Map<string, AssetReviewSummary>;
  transactions: Transaction[];
}

export function aggregateCurrentHoldings(
  snapshotAssets: BalanceSnapshotAsset[],
  parseQuantity: (value: string) => Decimal
): Map<string, { assetSymbols: string[]; currentQuantity: string }> {
  const holdings = new Map<string, { assetSymbols: Set<string>; quantity: Decimal }>();

  for (const asset of snapshotAssets) {
    const existing = holdings.get(asset.assetId);
    if (existing) {
      existing.assetSymbols.add(asset.assetSymbol);
      existing.quantity = existing.quantity.plus(parseQuantity(asset.calculatedBalance));
      holdings.set(asset.assetId, existing);
      continue;
    }

    holdings.set(asset.assetId, {
      assetSymbols: new Set([asset.assetSymbol]),
      quantity: parseQuantity(asset.calculatedBalance),
    });
  }

  return new Map(
    [...holdings.entries()].map(([assetId, value]) => [
      assetId,
      {
        assetSymbols: [...value.assetSymbols].sort((left, right) => left.localeCompare(right)),
        currentQuantity: value.quantity.toFixed(),
      },
    ])
  );
}

export function mergeAssetSymbols(...symbolGroups: (string[] | undefined)[]): string[] {
  const symbols = new Set<string>();
  for (const group of symbolGroups) {
    for (const symbol of group ?? []) {
      symbols.add(symbol);
    }
  }

  return [...symbols].sort((left, right) => left.localeCompare(right));
}
