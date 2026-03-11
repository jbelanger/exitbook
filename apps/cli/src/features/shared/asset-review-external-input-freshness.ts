import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  closeTokenMetadataDatabase,
  createTokenMetadataDatabase,
  createTokenMetadataQueries,
} from '@exitbook/blockchain-providers';
import { err, ok, type Result } from '@exitbook/core';
import { OverrideStore } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('asset-review-external-input-freshness');
const ASSET_REVIEW_OVERRIDE_SCOPES = ['asset-review-confirm', 'asset-review-clear'] as const;

export async function findLatestAssetReviewExternalInputAt(dataDir: string): Promise<Result<Date | undefined, Error>> {
  const overrideStore = new OverrideStore(dataDir);
  const latestOverrideAtResult = await overrideStore.findLatestCreatedAt([...ASSET_REVIEW_OVERRIDE_SCOPES]);
  if (latestOverrideAtResult.isErr()) {
    return err(new Error(`Failed to load asset review override freshness: ${latestOverrideAtResult.error.message}`));
  }

  const latestTokenMetadataAtResult = await findLatestTokenMetadataRefreshAt(path.join(dataDir, 'token-metadata.db'));
  if (latestTokenMetadataAtResult.isErr()) {
    return err(latestTokenMetadataAtResult.error);
  }

  return ok(pickLatestDate(latestOverrideAtResult.value, latestTokenMetadataAtResult.value));
}

async function findLatestTokenMetadataRefreshAt(tokenMetadataDbPath: string): Promise<Result<Date | undefined, Error>> {
  if (!existsSync(tokenMetadataDbPath)) {
    return ok(undefined);
  }

  const tokenMetadataDbResult = createTokenMetadataDatabase(tokenMetadataDbPath);
  if (tokenMetadataDbResult.isErr()) {
    return err(
      new Error(`Failed to open token metadata database for freshness: ${tokenMetadataDbResult.error.message}`)
    );
  }

  const tokenMetadataDb = tokenMetadataDbResult.value;

  try {
    const tokenMetadataQueries = createTokenMetadataQueries(tokenMetadataDb);
    return await tokenMetadataQueries.getLatestRefreshAt();
  } finally {
    await closeTokenMetadataDatabase(tokenMetadataDb).catch((error: unknown) => {
      logger.warn({ error }, 'Failed to close token metadata database after freshness check');
    });
  }
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
