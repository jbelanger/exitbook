import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import { ProviderError } from '@exitbook/blockchain-providers';
import type { TokenMetadata, TokenMetadataRecord } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { TokenMetadataQueries } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

const logger = getLogger('token-metadata-utils');

/**
 * Get token metadata from cache or fetch from provider if not available.
 * Implements cache-aside pattern with background refresh for stale data.
 *
 * Flow:
 * 1. Check DB cache first (fast path)
 * 2. If found and fresh (< 7 days): return cached data
 * 3. If found but stale (>= 7 days): return cached data + trigger background refresh
 * 4. If not found: fetch from provider, cache (with provider name in source field), and return
 *
 * @param blockchain - Blockchain identifier
 * @param contractAddress - Token contract address
 * @param tokenMetadataRepository - Repository for DB caching
 * @param providerManager - Provider manager for fetching from APIs
 * @returns Token metadata or undefined if not found (source field populated with provider name)
 */
export async function getOrFetchTokenMetadata(
  blockchain: string,
  contractAddress: string,
  tokenMetadataRepository: TokenMetadataQueries,
  providerManager: BlockchainProviderManager
): Promise<Result<TokenMetadataRecord | undefined, Error>> {
  try {
    // 1. Check cache first
    const cacheResult = await tokenMetadataRepository.getByContract(blockchain, contractAddress);
    if (cacheResult.isErr()) {
      return err(cacheResult.error);
    }

    const cachedMetadata = cacheResult.value;

    // 2. If found in cache
    if (cachedMetadata) {
      // Check staleness
      const isStale = tokenMetadataRepository.isStale(cachedMetadata.refreshedAt);

      if (isStale) {
        // Return stale data but refresh in background
        tokenMetadataRepository.refreshInBackground(blockchain, contractAddress, async () => {
          const result = await fetchFromProvider(blockchain, contractAddress, providerManager);
          // If the result contains undefined, convert to error since refreshInBackground expects actual metadata
          if (result.isOk() && result.value === undefined) {
            return err(new Error('Provider does not support token metadata'));
          }
          return result as Result<TokenMetadataRecord, Error>;
        });
      }

      return ok(cachedMetadata);
    }

    // 3. Not in cache - fetch from provider
    const fetchResult = await fetchFromProvider(blockchain, contractAddress, providerManager);

    if (fetchResult.isErr()) {
      return err(fetchResult.error);
    }

    const metadata = fetchResult.value;

    // Provider doesn't support metadata operation
    if (!metadata) {
      return ok(undefined);
    }

    // Ensure refreshedAt is populated to satisfy TokenMetadataRecord contract
    const completeMetadata: TokenMetadataRecord = {
      ...metadata,
      contractAddress,
      refreshedAt: metadata.refreshedAt ?? new Date(),
    };

    // 4. Cache the result
    const saveResult = await tokenMetadataRepository.save(blockchain, contractAddress, completeMetadata);
    if (saveResult.isErr()) {
      logger.error(
        { error: saveResult.error, blockchain, contractAddress },
        'Failed to cache token metadata, returning fetched data anyway'
      );
      return ok(completeMetadata);
    }

    return ok(completeMetadata);
  } catch (error) {
    return wrapError(error, `Failed to get or fetch token metadata for ${blockchain}:${contractAddress}`);
  }
}

/**
 * Fetch token metadata from provider using provider manager.
 * Returns undefined if providers don't support metadata operation.
 * Populates the source field with the actual provider name.
 */
async function fetchFromProvider(
  blockchain: string,
  contractAddress: string,
  providerManager: BlockchainProviderManager
): Promise<Result<TokenMetadataRecord | undefined, Error>> {
  try {
    // For single contract, use the batch function with array of 1
    const batchResult = await fetchBatchFromProvider(blockchain, [contractAddress], providerManager);

    if (batchResult.isErr()) {
      return err(batchResult.error);
    }

    const results = batchResult.value;
    return ok(results.length > 0 ? results[0] : undefined);
  } catch (error) {
    return wrapError(error, `Failed to fetch token metadata from provider for ${blockchain}:${contractAddress}`);
  }
}

/**
 * Fetch token metadata for multiple contracts in a single batch request.
 * Returns empty array if providers don't support metadata operation.
 * Populates the source field with the actual provider name for each result.
 */
async function fetchBatchFromProvider(
  blockchain: string,
  contractAddresses: string[],
  providerManager: BlockchainProviderManager
): Promise<Result<TokenMetadataRecord[], Error>> {
  try {
    if (contractAddresses.length === 0) {
      return ok([]);
    }

    // executeWithFailover handles auto-registration and capability checking
    const result = await providerManager.executeWithFailoverOnce<TokenMetadata[]>(blockchain, {
      type: 'getTokenMetadata',
      contractAddresses,
    });

    if (result.isErr()) {
      // Check if error is due to unsupported operation (not a failure)
      if (result.error instanceof ProviderError && result.error.code === 'NO_PROVIDERS') {
        return ok([]);
      }
      return err(result.error);
    }

    // Populate source with the actual provider name for provenance tracking
    const metadataWithSource: TokenMetadataRecord[] = result.value.data.map((metadata) => ({
      ...metadata,
      source: result.value.providerName,
      blockchain,
      refreshedAt: new Date(),
    }));

    return ok(metadataWithSource);
  } catch (error) {
    return wrapError(
      error,
      `Failed to fetch batch token metadata from provider for ${blockchain} (${contractAddresses.length} addresses)`
    );
  }
}

/**
 * Get token metadata for multiple contracts from cache or fetch from provider if not available.
 * Optimized batch version of getOrFetchTokenMetadata that reduces API calls.
 *
 * Flow:
 * 1. Check DB cache for all contracts first
 * 2. Batch fetch only uncached contracts from provider
 * 3. Return Map of contract address -> metadata
 * 4. Background refresh for stale cached data
 *
 * @param blockchain - Blockchain identifier
 * @param contractAddresses - Array of token contract addresses
 * @param tokenMetadataRepository - Repository for DB caching
 * @param providerManager - Provider manager for fetching from APIs
 * @returns Map of contract address to metadata (undefined if not found)
 */
export async function getOrFetchTokenMetadataBatch(
  blockchain: string,
  contractAddresses: string[],
  tokenMetadataRepository: TokenMetadataQueries,
  providerManager: BlockchainProviderManager
): Promise<Result<Map<string, TokenMetadataRecord | undefined>, Error>> {
  try {
    const metadataMap = new Map<string, TokenMetadataRecord | undefined>();

    if (contractAddresses.length === 0) {
      return ok(metadataMap);
    }

    // Step 1: Check cache for all contracts in parallel
    const uncachedContracts: string[] = [];
    const staleContracts: string[] = [];

    // Fetch all cache lookups in parallel
    const cachePromises = contractAddresses.map((contractAddress) =>
      tokenMetadataRepository.getByContract(blockchain, contractAddress).then((result) => ({
        contractAddress,
        result,
      }))
    );

    const cacheResults = await Promise.all(cachePromises);

    for (const { contractAddress, result: cacheResult } of cacheResults) {
      if (cacheResult.isErr()) {
        logger.warn({ error: cacheResult.error, blockchain, contractAddress }, 'Cache lookup failed');
        uncachedContracts.push(contractAddress);
        continue;
      }

      const cached = cacheResult.value;
      if (cached) {
        metadataMap.set(contractAddress, cached);
        const isStale = tokenMetadataRepository.isStale(cached.refreshedAt);
        if (isStale) {
          staleContracts.push(contractAddress);
        }
      } else {
        uncachedContracts.push(contractAddress);
      }
    }

    // Step 2: Batch fetch uncached contracts from provider in chunks to avoid HTTP 414 (URL too large)
    if (uncachedContracts.length > 0) {
      const BATCH_SIZE = 100;
      logger.info(
        { blockchain, count: uncachedContracts.length, batches: Math.ceil(uncachedContracts.length / BATCH_SIZE) },
        `Fetching ${uncachedContracts.length} uncached tokens in ${Math.ceil(uncachedContracts.length / BATCH_SIZE)} batch(es) of up to ${BATCH_SIZE}`
      );

      // Process in batches to avoid URL length limits
      for (let i = 0; i < uncachedContracts.length; i += BATCH_SIZE) {
        const batchAddresses = uncachedContracts.slice(i, i + BATCH_SIZE);
        const fetchResult = await fetchBatchFromProvider(blockchain, batchAddresses, providerManager);

        if (fetchResult.isErr()) {
          logger.warn(
            {
              error: fetchResult.error,
              blockchain,
              count: batchAddresses.length,
              batch: Math.floor(i / BATCH_SIZE) + 1,
            },
            'Batch fetch from provider failed'
          );
          // Mark uncached contracts as undefined (not found)
          for (const addr of batchAddresses) {
            metadataMap.set(addr, undefined);
          }
        } else {
          const fetchedMetadata = fetchResult.value;

          // Cache each fetched metadata in parallel and add to result map
          const savePromises = fetchedMetadata
            .filter((metadata) => metadata.contractAddress)
            .map((metadata) =>
              tokenMetadataRepository
                .save(blockchain, metadata.contractAddress, metadata)
                .then((saveResult) => {
                  if (saveResult.isErr()) {
                    logger.error(
                      { error: saveResult.error, blockchain, contractAddress: metadata.contractAddress },
                      'Failed to cache token metadata'
                    );
                  }
                  return metadata;
                })
                .catch((error) => {
                  logger.error(
                    { error, blockchain, contractAddress: metadata.contractAddress },
                    'Save operation threw'
                  );
                  return metadata;
                })
            );

          const savedMetadata = await Promise.all(savePromises);

          // Add to result map
          for (const metadata of savedMetadata) {
            metadataMap.set(metadata.contractAddress, metadata);
          }

          // Mark any contracts that weren't returned by provider as undefined
          for (const addr of batchAddresses) {
            if (!metadataMap.has(addr)) {
              metadataMap.set(addr, undefined);
            }
          }
        }
      }
    }

    // Step 3: Background refresh for stale contracts (fire and forget)
    if (staleContracts.length > 0) {
      fetchBatchFromProvider(blockchain, staleContracts, providerManager)
        .then((result) => {
          if (result.isOk()) {
            for (const metadata of result.value) {
              if (metadata.contractAddress) {
                tokenMetadataRepository.save(blockchain, metadata.contractAddress, metadata).catch((error) => {
                  logger.error(
                    { error, blockchain, contractAddress: metadata.contractAddress },
                    'Background refresh: Failed to cache token metadata'
                  );
                });
              }
            }
          }
        })
        .catch((error) => {
          logger.warn({ error, blockchain, count: staleContracts.length }, 'Background refresh failed');
        });
    }

    // Log summary of batch operation
    const cachedCount = contractAddresses.length - uncachedContracts.length;
    const BATCH_SIZE = 100;
    const numBatches = Math.ceil(uncachedContracts.length / BATCH_SIZE);
    const batchDesc = numBatches === 1 ? 'single API call' : `${numBatches} API calls`;
    logger.info(
      {
        blockchain,
        total: contractAddresses.length,
        cached: cachedCount,
        fetched: uncachedContracts.length,
        batches: numBatches,
      },
      `Batch metadata fetch complete: ${cachedCount} from cache, ${uncachedContracts.length} from ${uncachedContracts.length > 0 ? batchDesc : 'API'}`
    );

    return ok(metadataMap);
  } catch (error) {
    return wrapError(error, `Failed to get or fetch token metadata batch for ${blockchain}`);
  }
}

/**
 * Enrich a batch of items with token metadata.
 * Generic function that works with any item type that has contract addresses.
 * The source field is automatically populated with the actual provider name.
 *
 * This follows the pattern from exchange-utils.js - pure functional core with dependency injection.
 *
 * @param items - Array of items to enrich
 * @param blockchain - Blockchain identifier
 * @param contractExtractor - Function to extract contract address from item
 * @param metadataUpdater - Function to update item with enriched metadata
 * @param tokenMetadataRepository - Repository for DB caching
 * @param providerManager - Provider manager for fetching from APIs
 * @param decimalsExtractor - Optional function to check if item already has decimals (enrichment failure OK if true)
 * @returns Result indicating success or failure
 *
 * @example
 * // Enrich balance data
 * await enrichTokenMetadataBatch(
 *   balances,
 *   'ethereum',
 *   (balance) => balance.contractAddress,
 *   (balance, metadata) => {
 *     balance.symbol = metadata.symbol;
 *     balance.decimals = metadata.decimals;
 *   },
 *   tokenMetadataRepository,
 *   providerManager,
 *   (balance) => balance.decimals !== undefined
 * );
 */
export async function enrichTokenMetadataBatch<T>(
  items: T[],
  blockchain: string,
  contractExtractor: (item: T) => string | undefined,
  metadataUpdater: (item: T, metadata: TokenMetadataRecord) => void,
  tokenMetadataRepository: TokenMetadataQueries,
  providerManager: BlockchainProviderManager,
  decimalsExtractor?: (item: T) => boolean
): Promise<Result<void, Error>> {
  try {
    // Collect unique contract addresses
    const contractAddresses = new Set<string>();
    for (const item of items) {
      const address = contractExtractor(item);
      if (address) {
        contractAddresses.add(address);
      }
    }

    if (contractAddresses.size === 0) {
      return ok();
    }

    // Fetch metadata for all unique contracts using batch operation
    const metadataMap = new Map<string, TokenMetadataRecord>();
    const failedContracts = new Set<string>();
    let successCount = 0;
    let failureCount = 0;

    // Step 1: Check cache for all contracts in parallel
    const cachedMetadata = new Map<string, TokenMetadataRecord>();
    const uncachedContracts: string[] = [];
    const staleContracts: string[] = [];

    // Fetch all cache lookups in parallel
    const cachePromises = Array.from(contractAddresses).map((contractAddress) =>
      tokenMetadataRepository.getByContract(blockchain, contractAddress).then((result) => ({
        contractAddress,
        result,
      }))
    );

    const cacheResults = await Promise.all(cachePromises);

    for (const { contractAddress, result: cacheResult } of cacheResults) {
      if (cacheResult.isErr()) {
        logger.warn({ error: cacheResult.error, blockchain, contractAddress }, 'Cache lookup failed');
        uncachedContracts.push(contractAddress);
        continue;
      }

      const cached = cacheResult.value;
      if (cached) {
        cachedMetadata.set(contractAddress, cached);
        const isStale = tokenMetadataRepository.isStale(cached.refreshedAt);
        if (isStale) {
          staleContracts.push(contractAddress);
        }
      } else {
        uncachedContracts.push(contractAddress);
      }
    }

    // Step 2: Batch fetch uncached contracts from provider in chunks to avoid HTTP 414 (URL too large)
    if (uncachedContracts.length > 0) {
      const BATCH_SIZE = 100;
      logger.info(
        { blockchain, count: uncachedContracts.length, batches: Math.ceil(uncachedContracts.length / BATCH_SIZE) },
        `Fetching ${uncachedContracts.length} uncached tokens in ${Math.ceil(uncachedContracts.length / BATCH_SIZE)} batch(es) of up to ${BATCH_SIZE}`
      );

      // Process in batches to avoid URL length limits
      for (let i = 0; i < uncachedContracts.length; i += BATCH_SIZE) {
        const batchAddresses = uncachedContracts.slice(i, i + BATCH_SIZE);
        const fetchResult = await fetchBatchFromProvider(blockchain, batchAddresses, providerManager);

        if (fetchResult.isErr()) {
          logger.warn(
            {
              error: fetchResult.error,
              blockchain,
              count: batchAddresses.length,
              batch: Math.floor(i / BATCH_SIZE) + 1,
            },
            'Batch fetch from provider failed'
          );
          failureCount += batchAddresses.length;
          batchAddresses.forEach((addr) => failedContracts.add(addr));
        } else {
          const fetchedMetadata = fetchResult.value;

          // Cache each fetched metadata in parallel
          const savePromises = fetchedMetadata
            .filter((metadata) => metadata.contractAddress)
            .map((metadata) =>
              tokenMetadataRepository
                .save(blockchain, metadata.contractAddress, metadata)
                .then((saveResult) => {
                  if (saveResult.isErr()) {
                    logger.error(
                      { error: saveResult.error, blockchain, contractAddress: metadata.contractAddress },
                      'Failed to cache token metadata'
                    );
                  }
                  return metadata;
                })
                .catch((error) => {
                  logger.error(
                    { error, blockchain, contractAddress: metadata.contractAddress },
                    'Save operation threw'
                  );
                  return metadata;
                })
            );

          const savedMetadata = await Promise.all(savePromises);

          // Add to result map
          for (const metadata of savedMetadata) {
            metadataMap.set(metadata.contractAddress, metadata);
            successCount++;
          }
        }
      }
    }

    // Step 3: Add cached metadata to result map
    for (const [contractAddress, metadata] of cachedMetadata) {
      metadataMap.set(contractAddress, metadata);
      successCount++;
    }

    // Step 4: Background refresh for stale contracts (fire and forget)
    if (staleContracts.length > 0) {
      fetchBatchFromProvider(blockchain, staleContracts, providerManager)
        .then((result) => {
          if (result.isOk()) {
            for (const metadata of result.value) {
              if (metadata.contractAddress) {
                tokenMetadataRepository.save(blockchain, metadata.contractAddress, metadata).catch((error) => {
                  logger.error(
                    { error, blockchain, contractAddress: metadata.contractAddress },
                    'Background refresh: Failed to cache token metadata'
                  );
                });
              }
            }
          }
        })
        .catch((error) => {
          logger.warn({ error, blockchain, count: staleContracts.length }, 'Background refresh failed');
        });
    }

    // Check if enrichment failures are acceptable (all failed items already have decimals)
    if (failureCount > 0 && successCount === 0) {
      // If decimalsExtractor provided, check if all failed items have decimals
      if (decimalsExtractor) {
        const allFailedHaveDecimals = items.every((item) => {
          const address = contractExtractor(item);
          if (!address || !failedContracts.has(address)) return true; // Not a failed item or not applicable
          return decimalsExtractor(item); // Check if this failed item has decimals
        });

        if (allFailedHaveDecimals) {
          logger.warn(
            { failureCount, blockchain },
            'Enrichment failed for all tokens, but all have decimals - continuing'
          );
          return ok(); // Safe to continue since all tokens have decimals for normalization
        }
      }

      return err(new Error(`Failed to fetch metadata for all ${failureCount} token contracts on ${blockchain}`));
    }

    // Log summary if there were partial failures
    if (failureCount > 0) {
      logger.warn({ successCount, failureCount, blockchain }, 'Partial failure in token metadata batch enrichment');
    }

    // Update items with enriched metadata
    for (const item of items) {
      const contractAddress = contractExtractor(item);
      if (contractAddress) {
        const metadata = metadataMap.get(contractAddress);
        if (metadata) {
          metadataUpdater(item, metadata);
        }
      }
    }

    return ok();
  } catch (error) {
    return wrapError(error, 'Failed to enrich token metadata batch');
  }
}

/**
 * Check if token metadata is incomplete (missing symbol or decimals).
 * Note: This does NOT check if the symbol looks like a contract address.
 * Callers should combine with looksLikeContractAddress() if needed.
 */
export function isMissingMetadata(symbol?: string, decimals?: number): boolean {
  return !symbol || decimals === undefined;
}

/**
 * Check if a string looks like a token contract address vs a readable symbol.
 * Useful for determining when to enrich token data.
 *
 * @param value - String to check
 * @param minLength - Minimum length for address (default 32 for Solana, 40+ for EVM)
 * @returns true if value looks like an address
 */
export function looksLikeContractAddress(value: string, minLength = 32): boolean {
  if (value.length < minLength) {
    return false;
  }

  // Addresses contain hex (for EVM) or base58 (for Solana), so they should have numbers
  // Human-readable symbols are typically all letters, even if long
  const hasNumbers = /\d/.test(value);

  return hasNumbers;
}
