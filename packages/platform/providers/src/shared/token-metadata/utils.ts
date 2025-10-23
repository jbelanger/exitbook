import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import { TokenMetadataCache } from './cache.ts';
import { createTokenMetadataDatabase, initializeTokenMetadataDatabase, type TokenMetadataDB } from './database.ts';
import type { TokenMetadata } from './schemas.ts';

const logger = getLogger('TokenMetadataCacheManager');

let globalCache: TokenMetadataCache | undefined;
let globalDb: TokenMetadataDB | undefined;

/**
 * Get or create the global token metadata cache instance (singleton)
 */
export async function getTokenMetadataCache(): Promise<TokenMetadataCache> {
  if (globalCache) {
    return globalCache;
  }

  logger.info('Initializing global token metadata cache...');

  const dbResult = createTokenMetadataDatabase();
  if (dbResult.isErr()) {
    throw dbResult.error;
  }

  globalDb = dbResult.value;

  const initResult = await initializeTokenMetadataDatabase(globalDb);
  if (initResult.isErr()) {
    throw initResult.error;
  }

  globalCache = new TokenMetadataCache(globalDb);
  logger.info('Global token metadata cache initialized successfully');

  return globalCache;
}

/**
 * Close the global token metadata cache (for cleanup/testing)
 */
export async function closeTokenMetadataCache(): Promise<void> {
  if (globalDb) {
    await globalDb.destroy();
    globalCache = undefined;
    globalDb = undefined;
    logger.info('Global token metadata cache closed');
  }
}

/**
 * Get token metadata with transparent caching
 * This is the DRY helper used by all API clients
 *
 * @param blockchain - The blockchain name (e.g., 'solana', 'ethereum')
 * @param contractAddress - The token contract address or mint address
 * @param fetchFn - Provider-specific function to fetch metadata from API
 * @param providerName - Provider name for cache source tracking
 * @returns Token metadata with symbol, name, decimals, etc.
 */
export async function getTokenMetadataWithCache(
  blockchain: string,
  contractAddress: string,
  fetchFn: () => Promise<Result<Partial<TokenMetadata>, Error>>,
  providerName: string
): Promise<Result<TokenMetadata, Error>> {
  const logger = getLogger('TokenMetadataHelpers');
  const cache = await getTokenMetadataCache();

  // 1. Check cache first
  const cachedResult = await cache.getByContract(blockchain, contractAddress);
  if (cachedResult.isErr()) {
    return err(cachedResult.error);
  }

  if (cachedResult.value) {
    const cached = cachedResult.value;

    // Fresh cache hit
    if (!cache.isStale(cached.updatedAt)) {
      logger.debug(
        `Cache hit (fresh) - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${cached.symbol ?? 'unknown'}`
      );
      return ok(cached);
    }

    // Stale cache hit - serve stale data but refresh in background
    logger.debug(
      `Cache hit (stale) - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${cached.symbol ?? 'unknown'}, triggering background refresh`
    );
    cache.refreshInBackground(blockchain, contractAddress, fetchFn, providerName);
    return ok(cached);
  }

  // 2. Cache miss - fetch from API
  logger.debug(`Cache miss - Blockchain: ${blockchain}, Contract: ${contractAddress}, fetching from API`);

  const fetchResult = await fetchFn();
  if (fetchResult.isErr()) {
    return err(fetchResult.error);
  }

  const fetchedMetadata = fetchResult.value;

  // 3. Store in cache
  const setResult = await cache.set(blockchain, contractAddress, fetchedMetadata, providerName);
  if (setResult.isErr()) {
    logger.warn(
      `Failed to cache metadata - Blockchain: ${blockchain}, Contract: ${contractAddress}, Error: ${setResult.error.message}`
    );
  }

  // 4. Return full metadata object
  const now = new Date();
  return ok({
    blockchain,
    contractAddress,
    symbol: fetchedMetadata.symbol,
    name: fetchedMetadata.name,
    decimals: fetchedMetadata.decimals,
    logoUrl: fetchedMetadata.logoUrl,
    source: providerName,
    updatedAt: fetchedMetadata.updatedAt ?? now,
    createdAt: fetchedMetadata.createdAt ?? now,
  });
}
