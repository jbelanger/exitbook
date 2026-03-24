import {
  createAssetReviewProviderSupport,
  findLatestTokenMetadataRefreshAt,
} from '@exitbook/blockchain-providers/asset-review';
import type { DataContext } from '@exitbook/data/context';
import { buildAssetReviewRuntimePorts } from '@exitbook/data/projections';
import { createAssetReviewProjectionRuntime, type AssetReviewProjectionRuntime } from '@exitbook/ingestion';

export function createCliAssetReviewProjectionRuntime(db: DataContext, dataDir: string): AssetReviewProjectionRuntime {
  return createAssetReviewProjectionRuntime({
    ports: buildAssetReviewRuntimePorts(db, dataDir),
    providerSupportFactory: {
      open: () => createAssetReviewProviderSupport(dataDir),
    },
    tokenMetadataFreshness: {
      findLatestTokenMetadataRefreshAt: () => findLatestTokenMetadataRefreshAt(dataDir),
    },
  });
}
