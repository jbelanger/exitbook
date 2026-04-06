import { parseAssetId } from '@exitbook/foundation';

import { requiresAssetReviewAction } from '../asset-view-filter.js';
import type { AssetViewItem } from '../command/assets-types.js';

export interface AssetBadgeDisplay {
  color: 'gray' | 'green' | 'yellow';
  label: 'Excluded' | 'Review' | 'Reviewed';
}

export function pluralizeAssetLabel(count: number, label: string): string {
  return count === 1 ? label : `${label}s`;
}

export function getPrimaryAssetSymbol(asset: AssetViewItem): string {
  return asset.assetSymbols[0] ?? '(unknown)';
}

export function getAssetBadge(asset: AssetViewItem): AssetBadgeDisplay | undefined {
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

export function getAssetReasonWithHint(asset: AssetViewItem): string | undefined {
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

export function getAssetReason(asset: AssetViewItem): string | undefined {
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

export function getAssetTuiActionHint(asset: AssetViewItem): string {
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

export function getAssetStaticActionHint(asset: AssetViewItem): string {
  if (asset.excluded) {
    return `Run "exitbook assets include --asset-id ${asset.assetId}" to include it again.`;
  }

  if (asset.confirmationIsStale) {
    return `Run "exitbook assets clear-review --asset-id ${asset.assetId}" to reopen this review.`;
  }

  if (asset.reviewStatus === 'needs-review') {
    if (asset.evidence.some((item) => item.kind === 'same-symbol-ambiguity')) {
      return `Run "exitbook assets confirm --asset-id ${asset.assetId}" to mark it reviewed, or "exitbook assets exclude --asset-id ${asset.assetId}" to exclude a conflicting asset.`;
    }

    return `Run "exitbook assets confirm --asset-id ${asset.assetId}" to mark it reviewed, or "exitbook assets exclude --asset-id ${asset.assetId}" to exclude it.`;
  }

  if (asset.reviewStatus === 'reviewed') {
    if (asset.accountingBlocked) {
      return `Run "exitbook assets exclude --asset-id ${asset.assetId}" to exclude a conflicting asset.`;
    }

    return `Run "exitbook assets clear-review --asset-id ${asset.assetId}" to reopen this review.`;
  }

  return 'Nothing needs your attention right now.';
}

export function formatAssetEvidenceMessage(kind: AssetViewItem['evidence'][number]['kind']): string {
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

export function formatAssetCoinGeckoReferenceStatus(referenceStatus: AssetViewItem['referenceStatus']): string {
  switch (referenceStatus) {
    case 'matched':
      return 'matched canonical token';
    case 'unmatched':
      return 'no canonical match';
    default:
      return 'no lookup result';
  }
}

export function getAssetBlockchainTokenIdentity(assetId: string): { chain: string; ref: string } | undefined {
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

export function getConflictingContracts(
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
      const identity = getAssetBlockchainTokenIdentity(assetId);
      return identity?.ref ?? assetId;
    });
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
