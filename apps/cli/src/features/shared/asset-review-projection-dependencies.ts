import path from 'node:path';

import {
  closeTokenMetadataDatabase,
  createCoinGeckoTokenReferenceResolver,
  createTokenMetadataDatabase,
  createTokenMetadataQueries,
  initializeTokenMetadataDatabase,
} from '@exitbook/blockchain-providers';
import { err, ok, type Result } from '@exitbook/core';
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
): Promise<Result<AssetReviewProjectionHostDependencies, Error>> {
  const overrideStore = new OverrideStore(dataDir);

  const dbResult = createTokenMetadataDatabase(path.join(dataDir, 'token-metadata.db'));
  if (dbResult.isErr()) {
    return err(new Error(`Failed to open token metadata database for asset review: ${dbResult.error.message}`));
  }

  const tokenMetadataDb = dbResult.value;

  const migrationResult = await initializeTokenMetadataDatabase(tokenMetadataDb);
  if (migrationResult.isErr()) {
    await closeTokenMetadataDatabase(tokenMetadataDb).catch((error: unknown) => {
      logger.warn({ error }, 'Failed to close token metadata database after initialization failure');
    });

    return err(
      new Error(`Failed to initialize token metadata database for asset review: ${migrationResult.error.message}`)
    );
  }

  const tokenMetadataQueries = createTokenMetadataQueries(tokenMetadataDb);

  const resolverResult = createCoinGeckoTokenReferenceResolver(tokenMetadataQueries);
  if (resolverResult.isErr()) {
    await closeTokenMetadataDatabase(tokenMetadataDb).catch((error: unknown) => {
      logger.warn({ error }, 'Failed to close token metadata database after resolver initialization failure');
    });

    return err(new Error(`Failed to initialize CoinGecko token reference resolver: ${resolverResult.error.message}`));
  }

  const tokenReferenceResolver = resolverResult.value;

  return ok({
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
  });
}
