import {
  createAssetReviewProviderSupport,
  findLatestTokenMetadataRefreshAt,
} from '@exitbook/blockchain-providers/asset-review';
import { buildAssetReviewRuntimePorts, type DataContext } from '@exitbook/data';
import type { Result } from '@exitbook/foundation';
import { createAssetReviewProjectionRuntime } from '@exitbook/ingestion';

function createRuntime(db: DataContext, dataDir: string) {
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

export function ensureAssetReviewProjectionFresh(db: DataContext, dataDir: string): Promise<Result<void, Error>> {
  return createRuntime(db, dataDir).ensureFresh();
}

export function rebuildAssetReviewProjection(db: DataContext, dataDir: string): Promise<Result<void, Error>> {
  return createRuntime(db, dataDir).rebuild();
}
