import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import {
  closeTokenMetadataDatabase,
  createTokenMetadataDatabase,
  createTokenMetadataQueries,
  type TokenMetadataQueries,
} from './persistence/index.js';
import { initTokenMetadataPersistence } from './persistence/runtime.js';
import {
  createCoinGeckoTokenReferenceResolver,
  type CoinGeckoTokenReferenceResolverConfig,
  type TokenReferenceResolver,
} from './reference/index.js';

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
  const persistenceResult = await initTokenMetadataPersistence(dataDir);
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
