import type { TokenMetadataRecord } from '@exitbook/core';
import type { Result } from 'neverthrow';

/**
 * Token metadata service interface.
 * Abstracts token metadata operations from storage and provider implementation details.
 * Enables dependency injection and testing without coupling to repositories or providers.
 */
export interface ITokenMetadataService {
  /**
   * Enrich a batch of items with token metadata.
   * Generic function that works with any item type that has contract addresses.
   * The source field is automatically populated with the actual provider name.
   *
   * @param items - Array of items to enrich
   * @param blockchain - Blockchain identifier
   * @param contractExtractor - Function to extract contract address from item
   * @param metadataUpdater - Function to update item with enriched metadata
   * @param decimalsExtractor - Optional function to check if item already has decimals (enrichment failure OK if true)
   * @returns Result indicating success or failure
   *
   * @example
   * // Enrich token transfers
   * await service.enrichBatch(
   *   transactions,
   *   'ethereum',
   *   (tx) => tx.tokenAddress,
   *   (tx, metadata) => {
   *     tx.tokenSymbol = metadata.symbol;
   *     tx.tokenDecimals = metadata.decimals;
   *   },
   *   (tx) => tx.tokenDecimals !== undefined
   * );
   */
  enrichBatch<T>(
    items: T[],
    blockchain: string,
    contractExtractor: (item: T) => string | undefined,
    metadataUpdater: (item: T, metadata: TokenMetadataRecord) => void,
    decimalsExtractor?: (item: T) => boolean
  ): Promise<Result<void, Error>>;

  /**
   * Get token metadata from cache or fetch from provider if not available.
   * Implements cache-aside pattern with background refresh for stale data.
   *
   * @param blockchain - Blockchain identifier
   * @param contractAddress - Token contract address
   * @returns Token metadata or undefined if not found
   */
  getOrFetch(blockchain: string, contractAddress: string): Promise<Result<TokenMetadataRecord | undefined, Error>>;
}
