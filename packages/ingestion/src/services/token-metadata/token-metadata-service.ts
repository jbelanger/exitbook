import type { TokenMetadataRecord } from '@exitbook/core';
import type { TokenMetadataRepository } from '@exitbook/data';
import type { BlockchainProviderManager } from '@exitbook/providers';
import type { Result } from 'neverthrow';

import type { ITokenMetadataService } from './token-metadata-service.interface.js';
import { enrichTokenMetadataBatch, getOrFetchTokenMetadata } from './token-metadata-utils.js';

/**
 * Token metadata service implementation.
 * Encapsulates repository and provider manager dependencies, providing a clean interface
 * for token metadata operations without exposing storage or provider implementation details.
 *
 * This follows the "Functional Core, Imperative Shell" pattern:
 * - Pure business logic lives in token-metadata-utils.js
 * - This class manages resources (repository, provider manager)
 * - Processors depend on ITokenMetadataService interface, not concrete dependencies
 */
export class TokenMetadataService implements ITokenMetadataService {
  constructor(
    private readonly tokenMetadataRepository: TokenMetadataRepository,
    private readonly providerManager: BlockchainProviderManager
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
    return enrichTokenMetadataBatch(
      items,
      blockchain,
      contractExtractor,
      metadataUpdater,
      this.tokenMetadataRepository,
      this.providerManager,
      decimalsExtractor
    );
  }

  /**
   * Get token metadata from cache or fetch from provider if not available.
   * Delegates to the pure function in token-metadata-utils.js
   */
  async getOrFetch(
    blockchain: string,
    contractAddress: string
  ): Promise<Result<TokenMetadataRecord | undefined, Error>> {
    return getOrFetchTokenMetadata(blockchain, contractAddress, this.tokenMetadataRepository, this.providerManager);
  }
}
