import {
  createAssetReviewProviderSupport,
  findLatestTokenMetadataRefreshAt,
} from '@exitbook/blockchain-providers/asset-review';
import { buildAssetReviewRuntimePorts } from '@exitbook/data/projections';
import type { DataSession } from '@exitbook/data/session';
import { createAssetReviewProjectionRuntime, type AssetReviewProjectionRuntime } from '@exitbook/ingestion';

import { buildPriceProviderConfigFromEnv } from '../../runtime/app-runtime.js';

export function createCliAssetReviewProjectionRuntime(db: DataSession, dataDir: string): AssetReviewProjectionRuntime {
  const coinGeckoConfig = buildPriceProviderConfigFromEnv().coingecko;

  return createAssetReviewProjectionRuntime({
    ports: buildAssetReviewRuntimePorts(db, dataDir),
    providerSupportFactory: {
      open: () => createAssetReviewProviderSupport(dataDir, coinGeckoConfig),
    },
    tokenMetadataFreshness: {
      findLatestTokenMetadataRefreshAt: () => findLatestTokenMetadataRefreshAt(dataDir),
    },
  });
}
