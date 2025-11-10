import type { TokenMetadata, TokenMetadataRecord } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { TokenMetadataRepository } from '@exitbook/data';
import type { BlockchainProviderManager } from '@exitbook/providers';
import { ProviderError } from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';
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
  tokenMetadataRepository: TokenMetadataRepository,
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
    // executeWithFailover handles auto-registration and capability checking
    const result = await providerManager.executeWithFailover<TokenMetadata>(blockchain, {
      type: 'getTokenMetadata',
      contractAddress,
    });

    if (result.isErr()) {
      // Check if error is due to unsupported operation (not a failure)
      if (result.error instanceof ProviderError && result.error.code === 'NO_PROVIDERS') {
        return ok(undefined);
      }
      return err(result.error);
    }

    // Populate source with the actual provider name for provenance tracking
    const metadataWithSource: TokenMetadataRecord = {
      ...result.value.data,
      source: result.value.providerName,
      blockchain,
      refreshedAt: new Date(),
    };

    return ok(metadataWithSource);
  } catch (error) {
    return wrapError(error, `Failed to fetch token metadata from provider for ${blockchain}:${contractAddress}`);
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
  tokenMetadataRepository: TokenMetadataRepository,
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

    // Fetch metadata for all unique contracts (sequential due to provider-manager limitations)
    const metadataMap = new Map<string, TokenMetadataRecord>();
    const failedContracts = new Set<string>();
    let successCount = 0;
    let failureCount = 0;

    for (const contractAddress of contractAddresses) {
      const result = await getOrFetchTokenMetadata(
        blockchain,
        contractAddress,
        tokenMetadataRepository,
        providerManager
      );

      if (result.isErr()) {
        failureCount++;
        failedContracts.add(contractAddress);
        logger.warn(
          { error: result.error, blockchain, contractAddress },
          'Failed to fetch token metadata, continuing with remaining tokens'
        );
        continue;
      }

      const metadata = result.value;
      if (metadata) {
        metadataMap.set(contractAddress, metadata);
      }
      // Count undefined as success (provider doesn't support metadata, not a failure)
      successCount++;
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
