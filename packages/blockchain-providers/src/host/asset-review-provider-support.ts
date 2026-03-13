import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Result } from '@exitbook/core';
import { err, ok } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import { createTokenMetadataPersistence } from '../persistence/token-metadata/factory.js';
import { closeTokenMetadataDatabase, createTokenMetadataDatabase } from '../persistence/token-metadata/index.js';
import { createTokenMetadataQueries, type TokenMetadataQueries } from '../persistence/token-metadata/queries.js';
import {
  createCoinGeckoTokenReferenceResolver,
  type CoinGeckoTokenReferenceResolverConfig,
  type TokenReferenceResolver,
} from '../reference/coingecko/coingecko-token-reference.js';

const logger = getLogger('AssetReviewProviderSupport');

export interface AssetReviewProviderSupport {
  referenceResolver: TokenReferenceResolver;
  tokenMetadataReader: {
    getByTokenRefs: TokenMetadataQueries['getByContracts'];
  };
  cleanup(): Promise<void>;
}

export async function createAssetReviewProviderSupport(
  dataDir: string,
  config: CoinGeckoTokenReferenceResolverConfig = {}
): Promise<Result<AssetReviewProviderSupport, Error>> {
  const persistenceResult = await createTokenMetadataPersistence(dataDir);
  if (persistenceResult.isErr()) {
    return err(
      new Error(`Failed to initialize token metadata persistence for asset review: ${persistenceResult.error.message}`)
    );
  }

  const persistence = persistenceResult.value;
  const resolverResult = createCoinGeckoTokenReferenceResolver(persistence.queries, config);
  if (resolverResult.isErr()) {
    await persistence.cleanup().catch((error: unknown) => {
      logger.warn({ error }, 'Failed to cleanup token metadata persistence after resolver initialization failure');
    });

    return err(new Error(`Failed to initialize CoinGecko token reference resolver: ${resolverResult.error.message}`));
  }

  const referenceResolver = resolverResult.value;

  return ok({
    tokenMetadataReader: {
      getByTokenRefs: (blockchain, tokenRefs) => persistence.queries.getByContracts(blockchain, tokenRefs),
    },
    referenceResolver,
    async cleanup() {
      await referenceResolver.close().catch((error: unknown) => {
        logger.warn({ error }, 'Failed to close token reference resolver');
      });

      await persistence.cleanup().catch((error: unknown) => {
        logger.warn({ error }, 'Failed to close token metadata persistence after asset review rebuild');
      });
    },
  });
}

export async function findLatestTokenMetadataRefreshAt(dataDir: string): Promise<Result<Date | undefined, Error>> {
  const dbPath = path.join(dataDir, 'token-metadata.db');
  if (!existsSync(dbPath)) {
    return ok(undefined);
  }

  const dbResult = createTokenMetadataDatabase(dbPath);
  if (dbResult.isErr()) {
    return err(new Error(`Failed to open token metadata database for freshness: ${dbResult.error.message}`));
  }

  const tokenMetadataDb = dbResult.value;

  try {
    const tokenMetadataQueries = createTokenMetadataQueries(tokenMetadataDb);
    return await tokenMetadataQueries.getLatestRefreshAt();
  } finally {
    const closeResult = await closeTokenMetadataDatabase(tokenMetadataDb);
    if (closeResult.isErr()) {
      logger.warn({ error: closeResult.error }, 'Failed to close token metadata database after freshness check');
    }
  }
}
