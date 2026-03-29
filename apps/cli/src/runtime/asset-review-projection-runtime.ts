import {
  createAssetReviewProviderSupport,
  findLatestTokenMetadataRefreshAt,
} from '@exitbook/blockchain-providers/asset-review';
import { buildAssetReviewRuntimePorts } from '@exitbook/data/projections';
import type { DataSession } from '@exitbook/data/session';
import { ok, wrapError, type Result } from '@exitbook/foundation';
import {
  createAssetReviewProjectionRuntime,
  type AssetReviewProjectionRuntime,
} from '@exitbook/ingestion/asset-review';

import { buildPriceProviderConfigFromEnv } from './app-runtime.js';

export function createCliAssetReviewProjectionRuntime(
  db: DataSession,
  dataDir: string,
  profile: { profileId: number; profileKey: string }
): Result<AssetReviewProjectionRuntime, Error> {
  try {
    const coinGeckoConfig = buildPriceProviderConfigFromEnv().coingecko;

    return ok(
      createAssetReviewProjectionRuntime({
        ports: buildAssetReviewRuntimePorts(db, dataDir, profile),
        providerSupportFactory: {
          open: () => createAssetReviewProviderSupport(dataDir, coinGeckoConfig),
        },
        tokenMetadataFreshness: {
          findLatestTokenMetadataRefreshAt: () => findLatestTokenMetadataRefreshAt(dataDir),
        },
      })
    );
  } catch (error) {
    return wrapError(error, `Failed to create asset review runtime for profile ${profile.profileKey}`);
  }
}
