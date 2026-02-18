import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { TokenMetadataRecord } from '@exitbook/core';
import type { TokenMetadataQueries } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';

import type { IngestionEvent } from '../../events.js';

import type { ITokenMetadataService } from './token-metadata-service.interface.js';
import {
  enrichTokenMetadataBatch,
  getOrFetchTokenMetadata,
  getOrFetchTokenMetadataBatch,
} from './token-metadata-utils.js';

/**
 * Token metadata service implementation.
 * Encapsulates queries and provider manager dependencies, providing a clean interface
 * for token metadata operations without exposing storage or provider implementation details.
 *
 * This follows the "Functional Core, Imperative Shell" pattern:
 * - Pure business logic lives in token-metadata-utils.js
 * - This class manages resources (queries, provider manager)
 * - Processors depend on ITokenMetadataService interface, not concrete dependencies
 */
export class TokenMetadataService implements ITokenMetadataService {
  private readonly logger = getLogger('TokenMetadataService');
  private batchCounter = 0;

  constructor(
    private readonly tokenMetadataQueries: TokenMetadataQueries,
    private readonly providerManager: BlockchainProviderManager,
    private readonly eventBus: EventBus<IngestionEvent>
  ) {}

  /**
   * Enrich a batch of items with token metadata.
   * Delegates to the pure function in token-metadata-utils.js
   */
  async enrichBatch<T>(
    items: T[],
    blockchain: string,
    contractExtractor: (item: T) => string | undefined,
    metadataUpdater: (item: T, metadata: TokenMetadataRecord) => void,
    decimalsExtractor?: (item: T) => boolean
  ): Promise<Result<void, Error>> {
    const startTime = Date.now();
    this.batchCounter += 1;

    // Track cache stats
    const stats = await this.trackCacheStats(items, blockchain, contractExtractor);

    // Call the pure enrichment function
    const result = await enrichTokenMetadataBatch(
      items,
      blockchain,
      contractExtractor,
      metadataUpdater,
      this.tokenMetadataQueries,
      this.providerManager,
      decimalsExtractor
    );

    // Emit event with per-batch stats only on success
    if (result.isOk()) {
      const durationMs = Date.now() - startTime;
      this.eventBus.emit({
        type: 'metadata.batch.completed',
        blockchain,
        batchNumber: this.batchCounter,
        cacheHits: stats.hits,
        cacheMisses: stats.misses,
        durationMs,
      });
    }

    return result;
  }

  /**
   * Get token metadata from cache or fetch from provider if not available.
   * Delegates to the pure function in token-metadata-utils.js
   */
  async getOrFetch(
    blockchain: string,
    contractAddress: string
  ): Promise<Result<TokenMetadataRecord | undefined, Error>> {
    return getOrFetchTokenMetadata(blockchain, contractAddress, this.tokenMetadataQueries, this.providerManager);
  }

  /**
   * Get token metadata for multiple contracts from cache or fetch from provider if not available.
   * Optimized batch version that reduces API calls.
   * Delegates to the pure function in token-metadata-utils.js
   */
  async getOrFetchBatch(
    blockchain: string,
    contractAddresses: string[]
  ): Promise<Result<Map<string, TokenMetadataRecord | undefined>, Error>> {
    return getOrFetchTokenMetadataBatch(blockchain, contractAddresses, this.tokenMetadataQueries, this.providerManager);
  }

  /**
   * Track cache hit/miss stats for a batch before enrichment.
   * Returns per-batch deltas (not cumulative).
   * Uses batch lookup for better performance.
   */
  private async trackCacheStats<T>(
    items: T[],
    blockchain: string,
    contractExtractor: (item: T) => string | undefined
  ): Promise<{ hits: number; misses: number }> {
    const contractAddresses = new Set<string>();
    for (const item of items) {
      const address = contractExtractor(item);
      if (address) {
        contractAddresses.add(address);
      }
    }

    if (contractAddresses.size === 0) {
      return { hits: 0, misses: 0 };
    }

    // Use batch lookup instead of N sequential queries
    const cacheResult = await this.tokenMetadataQueries.getByContracts(blockchain, Array.from(contractAddresses));

    if (cacheResult.isErr()) {
      this.logger.warn({ error: cacheResult.error, blockchain }, 'Batch cache lookup failed, treating all as misses');
      return { hits: 0, misses: contractAddresses.size };
    }

    let hits = 0;
    let misses = 0;

    for (const [, metadata] of cacheResult.value) {
      if (metadata) {
        hits += 1;
      } else {
        misses += 1;
      }
    }

    return { hits, misses };
  }
}
