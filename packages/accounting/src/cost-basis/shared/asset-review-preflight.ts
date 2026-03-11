import type { AssetReviewSummary } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';

import type { AccountingScopedTransaction } from '../matching/build-cost-basis-scoped-transactions.js';

function formatNeedsReviewMessage(assets: AssetReviewSummary[]): string {
  const lines = ['Assets flagged for review require confirmation or exclusion before accounting can proceed:'];

  for (const asset of assets) {
    lines.push(`- ${asset.assetId}: ${asset.warningSummary ?? 'Suspicious asset evidence requires review'}`);
  }

  lines.push("Review these assets in 'exitbook assets view --needs-review'.");
  lines.push("Confirm intended assets with 'exitbook assets confirm --asset-id <assetId>'.");
  lines.push("Exclude unwanted contracts with 'exitbook assets exclude --asset-id <assetId>'.");

  return lines.join('\n');
}

export function assertNoScopedAssetsRequireReview(
  scopedTransactions: AccountingScopedTransaction[],
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary>  
): Result<void, Error> {
  if (!assetReviewSummaries || assetReviewSummaries.size === 0) {
    return ok(undefined);
  }

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

  const flaggedAssets = [...assetsInScope]
    .map((assetId) => assetReviewSummaries.get(assetId))
    .filter(
      (summary): summary is AssetReviewSummary => summary !== undefined && summary.reviewStatus === 'needs-review'
    )
    .sort((left, right) => left.assetId.localeCompare(right.assetId));

  if (flaggedAssets.length === 0) {
    return ok(undefined);
  }

  return err(new Error(formatNeedsReviewMessage(flaggedAssets)));
}
