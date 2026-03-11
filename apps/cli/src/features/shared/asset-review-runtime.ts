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
import type { AssetReviewSummary, UniversalTransactionData } from '@exitbook/core';
import { err, type Result } from '@exitbook/core';
import { OverrideStore, readAssetReviewDecisions } from '@exitbook/data';
import { buildAssetReviewSummaries } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('asset-review-runtime');

export async function loadAssetReviewSummaries(
  dataDir: string,
  transactions: UniversalTransactionData[]
): Promise<Result<Map<string, AssetReviewSummary>, Error>> {
  const overrideStore = new OverrideStore(dataDir);
  const decisionsResult = await readAssetReviewDecisions(overrideStore);
  if (decisionsResult.isErr()) {
    return err(decisionsResult.error);
  }

  let tokenMetadataDb: TokenMetadataDB | undefined;
  let tokenReferenceResolver: TokenReferenceResolver | undefined;
  let tokenMetadataQueries: ReturnType<typeof createTokenMetadataQueries> | undefined;

  try {
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

    return await buildAssetReviewSummaries(transactions, {
      reviewDecisions: decisionsResult.value,
      tokenMetadataReader: tokenMetadataQueries,
      referenceResolver: tokenReferenceResolver,
    });
  } finally {
    if (tokenReferenceResolver) {
      await tokenReferenceResolver.close().catch((error: unknown) => {
        logger.warn({ error }, 'Failed to close token reference resolver');
      });
    }

    if (tokenMetadataDb) {
      await closeTokenMetadataDatabase(tokenMetadataDb).catch((error: unknown) => {
        logger.warn({ error }, 'Failed to close token metadata database after asset review load');
      });
    }
  }
}
