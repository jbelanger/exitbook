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
import type { PriceProviderConfig } from '@exitbook/price-providers';

export interface CreateCliAssetReviewProjectionRuntimeOptions {
  priceProviderConfig: Pick<PriceProviderConfig, 'coingecko'>;
  profile: { profileId: number; profileKey: string };
}

export function createCliAssetReviewProjectionRuntime(
  db: DataSession,
  dataDir: string,
  options: CreateCliAssetReviewProjectionRuntimeOptions
): Result<AssetReviewProjectionRuntime, Error> {
  try {
    return ok(
      createAssetReviewProjectionRuntime({
        ports: buildAssetReviewRuntimePorts(db, dataDir, options.profile),
        providerSupportFactory: {
          open: () => createAssetReviewProviderSupport(dataDir, options.priceProviderConfig.coingecko),
        },
        tokenMetadataFreshness: {
          findLatestTokenMetadataRefreshAt: () => findLatestTokenMetadataRefreshAt(dataDir),
        },
      })
    );
  } catch (error) {
    return wrapError(error, `Failed to create asset review runtime for profile ${options.profile.profileKey}`);
  }
}
