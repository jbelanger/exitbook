import type { AssetReviewSummary } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { AccountingScopedTransaction } from './accounting-scoped-types.js';

function formatNeedsReviewMessage(assets: AssetReviewSummary[]): string {
  const lines = ['Assets flagged for review require confirmation or exclusion before accounting can proceed:'];

  for (const asset of assets) {
    lines.push(`- ${asset.assetId}: ${asset.warningSummary ?? 'Suspicious asset evidence requires review'}`);
  }

  if (assets.some((asset) => asset.evidence.some((item) => item.kind === 'same-symbol-ambiguity'))) {
    lines.push('Ambiguous on-chain asset symbols remain blocked until the unwanted contract is excluded.');
  }

  lines.push("Review these assets in 'exitbook assets explore --needs-review'.");
  lines.push("Confirm intended assets with 'exitbook assets confirm --asset-id <assetId>'.");
  lines.push("Exclude unwanted contracts with 'exitbook assets exclude --asset-id <assetId>'.");

  return lines.join('\n');
}

export function assertNoScopedAssetsRequireReview(
  scopedTransactions: AccountingScopedTransaction[],
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary>
): Result<void, Error> {
  const assetsInScope = new Set<string>();
  for (const scopedTransaction of scopedTransactions) {
    for (const inflow of scopedTransaction.movements.inflows) {
      assetsInScope.add(inflow.assetId);
    }
    for (const outflow of scopedTransaction.movements.outflows) {
      assetsInScope.add(outflow.assetId);
    }
    for (const fee of scopedTransaction.fees) {
      assetsInScope.add(fee.assetId);
    }
  }

  const flaggedAssets = collectBlockingAssetReviewSummaries(assetsInScope, assetReviewSummaries);
  if (flaggedAssets.length === 0) {
    return ok(undefined);
  }

  return err(new Error(formatNeedsReviewMessage(flaggedAssets)));
}

export function collectBlockingAssetReviewSummaries(
  assetsInScope: ReadonlySet<string>,
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary>
): AssetReviewSummary[] {
  if (!assetReviewSummaries || assetReviewSummaries.size === 0) {
    return [];
  }

  return [...assetsInScope]
    .map((assetId) => assetReviewSummaries.get(assetId))
    .filter(
      (summary): summary is AssetReviewSummary => summary !== undefined && stillBlocksAccounting(summary, assetsInScope)
    )
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
}

function stillBlocksAccounting(summary: AssetReviewSummary, assetsInScope: ReadonlySet<string>): boolean {
  if (!summary.accountingBlocked) {
    return false;
  }

  const ambiguityEvidence = summary.evidence.filter((item) => item.kind === 'same-symbol-ambiguity');
  if (ambiguityEvidence.length === 0) {
    return true;
  }

  if (ambiguityEvidence.some((item) => sameSymbolAmbiguityStillBlocks(summary.assetId, item.metadata, assetsInScope))) {
    return true;
  }

  if (summary.reviewStatus !== 'needs-review') {
    return false;
  }

  return summary.evidence.some((item) => item.kind !== 'same-symbol-ambiguity' && item.severity === 'error');
}

function sameSymbolAmbiguityStillBlocks(
  assetId: string,
  metadata: AssetReviewSummary['evidence'][number]['metadata'],
  assetsInScope: ReadonlySet<string>
): boolean {
  const conflictingAssetIds = metadata?.['conflictingAssetIds'];
  if (!Array.isArray(conflictingAssetIds) || conflictingAssetIds.some((item) => typeof item !== 'string')) {
    return true;
  }

  const validatedIds = conflictingAssetIds as string[];
  return validatedIds.some(
    (conflictingAssetId) => conflictingAssetId !== assetId && assetsInScope.has(conflictingAssetId)
  );
}
