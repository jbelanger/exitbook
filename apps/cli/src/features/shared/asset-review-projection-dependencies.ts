import path from 'node:path';

import {
  closeTokenMetadataDatabase,
  createCoinGeckoTokenReferenceResolver,
  createTokenMetadataDatabase,
  createTokenMetadataQueries,
  initializeTokenMetadataDatabase,
  type TokenMetadataDB,
  type TokenReferenceResolver,
} from '@exitbook/blockchain-providers';
import { OverrideStore, readAssetReviewDecisions } from '@exitbook/data';
import type { AssetReviewReferenceResolver, AssetReviewTokenMetadataReader } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('asset-review-projection-dependencies');

export interface AssetReviewProjectionHostDependencies {
  loadReviewDecisions: () => ReturnType<typeof readAssetReviewDecisions>;
  referenceResolver?: AssetReviewReferenceResolver | undefined;
  tokenMetadataReader?: AssetReviewTokenMetadataReader | undefined;
  close(): Promise<void>;
}

export async function createAssetReviewProjectionHostDependencies(
  dataDir: string
): Promise<AssetReviewProjectionHostDependencies> {
  const overrideStore = new OverrideStore(dataDir);

  let tokenMetadataDb: TokenMetadataDB | undefined;
  let tokenReferenceResolver: TokenReferenceResolver | undefined;
  let tokenMetadataQueries: ReturnType<typeof createTokenMetadataQueries> | undefined;

  const dbResult = createTokenMetadataDatabase(path.join(dataDir, 'token-metadata.db'));
  if (dbResult.isOk()) {
    tokenMetadataDb = dbResult.value;
    const migrationResult = await initializeTokenMetadataDatabase(tokenMetadataDb);
    if (migrationResult.isErr()) {
      logger.warn({ error: migrationResult.error }, 'Failed to initialize token metadata database for asset review');
    } else {
      tokenMetadataQueries = createTokenMetadataQueries(tokenMetadataDb);
      const resolverResult = createCoinGeckoTokenReferenceResolver(tokenMetadataQueries);
      if (resolverResult.isErr()) {
        logger.warn({ error: resolverResult.error }, 'Failed to initialize CoinGecko token reference resolver');
      } else {
        tokenReferenceResolver = resolverResult.value;
      }
    }
  } else {
    logger.warn({ error: dbResult.error }, 'Failed to open token metadata database for asset review');
  }

  return {
    loadReviewDecisions: () => readAssetReviewDecisions(overrideStore),
    tokenMetadataReader: tokenMetadataQueries,
    referenceResolver: tokenReferenceResolver,
    async close() {
      if (tokenReferenceResolver) {
        await tokenReferenceResolver.close().catch((error: unknown) => {
          logger.warn({ error }, 'Failed to close token reference resolver');
        });
      }

      if (tokenMetadataDb) {
        await closeTokenMetadataDatabase(tokenMetadataDb).catch((error: unknown) => {
          logger.warn({ error }, 'Failed to close token metadata database after asset review rebuild');
        });
      }
    },
  };
}
