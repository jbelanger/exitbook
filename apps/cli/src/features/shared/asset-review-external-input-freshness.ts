import { findLatestTokenMetadataRefreshAt } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from '@exitbook/core';
import { OverrideStore } from '@exitbook/data';

const ASSET_REVIEW_OVERRIDE_SCOPES = ['asset-review-confirm', 'asset-review-clear'] as const;

export async function findLatestAssetReviewExternalInputAt(dataDir: string): Promise<Result<Date | undefined, Error>> {
  const overrideStore = new OverrideStore(dataDir);
  const latestOverrideAtResult = await overrideStore.findLatestCreatedAt([...ASSET_REVIEW_OVERRIDE_SCOPES]);
  if (latestOverrideAtResult.isErr()) {
    return err(new Error(`Failed to load asset review override freshness: ${latestOverrideAtResult.error.message}`));
  }

  const latestTokenMetadataAtResult = await findLatestTokenMetadataRefreshAt(dataDir);
  if (latestTokenMetadataAtResult.isErr()) {
    return err(latestTokenMetadataAtResult.error);
  }

  return ok(pickLatestDate(latestOverrideAtResult.value, latestTokenMetadataAtResult.value));
}

function pickLatestDate(...dates: (Date | undefined)[]): Date | undefined {
  let latest: Date | undefined;

  for (const date of dates) {
    if (!date) {
      continue;
    }

    if (!latest || date > latest) {
      latest = date;
    }
  }

  return latest;
}
