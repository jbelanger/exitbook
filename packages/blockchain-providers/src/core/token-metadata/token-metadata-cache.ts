import type { TokenMetadataRecord } from '@exitbook/core';
import type { TokenMetadata } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { ProviderEvent } from '../../events.js';
import type { TokenMetadataQueries } from '../../persistence/token-metadata/queries.js';
import { ProviderError } from '../types/errors.js';
import type { FailoverExecutionResult } from '../types/index.js';

const BATCH_SIZE = 100;

type FetchFn = (
  blockchain: string,
  contractAddresses: string[]
) => Promise<Result<FailoverExecutionResult<TokenMetadata[]>, ProviderError>>;

export class TokenMetadataCache {
  private readonly logger = getLogger('TokenMetadataCache');

  constructor(
    private readonly queries: TokenMetadataQueries,
    private readonly fetchFn: FetchFn,
    private readonly eventBus?: EventBus<ProviderEvent> | undefined
  ) {}

  async getBatch(
    blockchain: string,
    contractAddresses: string[]
  ): Promise<Result<Map<string, TokenMetadataRecord | undefined>, Error>> {
    const startTime = Date.now();
    const metadataMap = new Map<string, TokenMetadataRecord | undefined>();

    if (contractAddresses.length === 0) {
      return ok(metadataMap);
    }

    // Step 1: Check cache for all contracts
    const uncachedContracts: string[] = [];
    const staleContracts: string[] = [];

    const cacheResult = await this.queries.getByContracts(blockchain, contractAddresses);
    if (cacheResult.isErr()) {
      this.logger.warn({ error: cacheResult.error, blockchain }, 'Batch cache lookup failed, fetching all');
      uncachedContracts.push(...contractAddresses);
    } else {
      for (const [address, cached] of cacheResult.value) {
        if (cached) {
          metadataMap.set(address, cached);
          if (this.queries.isStale(cached.refreshedAt)) {
            staleContracts.push(address);
          }
        } else {
          uncachedContracts.push(address);
        }
      }
    }

    const cacheHits = contractAddresses.length - uncachedContracts.length;

    // Step 2: Batch fetch uncached contracts in chunks
    if (uncachedContracts.length > 0) {
      this.logger.info(
        { blockchain, count: uncachedContracts.length, batches: Math.ceil(uncachedContracts.length / BATCH_SIZE) },
        `Fetching ${uncachedContracts.length} uncached tokens in ${Math.ceil(uncachedContracts.length / BATCH_SIZE)} batch(es)`
      );

      for (let i = 0; i < uncachedContracts.length; i += BATCH_SIZE) {
        const batchAddresses = uncachedContracts.slice(i, i + BATCH_SIZE);
        const fetchResult = await this.fetchFn(blockchain, batchAddresses);

        if (fetchResult.isErr()) {
          if (fetchResult.error instanceof ProviderError && fetchResult.error.code === 'NO_PROVIDERS') {
            // No providers support metadata — mark all as undefined
            for (const addr of batchAddresses) {
              metadataMap.set(addr, undefined);
            }
          } else {
            this.logger.warn(
              {
                error: fetchResult.error,
                blockchain,
                count: batchAddresses.length,
                batch: Math.floor(i / BATCH_SIZE) + 1,
              },
              'Batch fetch from provider failed'
            );
            for (const addr of batchAddresses) {
              metadataMap.set(addr, undefined);
            }
          }
        } else {
          const { data: fetchedMetadata, providerName } = fetchResult.value;

          // Enrich raw TokenMetadata → TokenMetadataRecord and save
          const savePromises = fetchedMetadata
            .filter((meta) => meta.contractAddress)
            .map(async (meta) => {
              const record: TokenMetadataRecord = {
                ...meta,
                blockchain,
                source: providerName,
                refreshedAt: new Date(),
              };

              const saveResult = await this.queries.save(blockchain, meta.contractAddress, record);
              if (saveResult.isErr()) {
                this.logger.error(
                  { error: saveResult.error, blockchain, contractAddress: meta.contractAddress },
                  'Failed to cache token metadata'
                );
              }

              return record;
            });

          const savedRecords = await Promise.all(savePromises);

          for (const record of savedRecords) {
            metadataMap.set(record.contractAddress, record);
          }

          // Mark addresses not returned by the provider as undefined
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
      this.refreshStaleContracts(blockchain, staleContracts);
    }

    const durationMs = Date.now() - startTime;
    this.logger.info(
      { blockchain, total: contractAddresses.length, cached: cacheHits, fetched: uncachedContracts.length, durationMs },
      `Batch metadata fetch complete: ${cacheHits} from cache, ${uncachedContracts.length} fetched`
    );

    this.eventBus?.emit({
      type: 'provider.metadata.batch.completed',
      blockchain,
      batchSize: contractAddresses.length,
      cacheHits,
      cacheMisses: uncachedContracts.length,
      durationMs,
    });

    return ok(metadataMap);
  }

  private refreshStaleContracts(blockchain: string, staleContracts: string[]): void {
    this.fetchFn(blockchain, staleContracts)
      .then((result) => {
        if (result.isOk()) {
          for (const meta of result.value.data) {
            if (meta.contractAddress) {
              const record: TokenMetadataRecord = {
                ...meta,
                blockchain,
                source: result.value.providerName,
                refreshedAt: new Date(),
              };
              this.queries.save(blockchain, meta.contractAddress, record).catch((error) => {
                this.logger.error(
                  { error, blockchain, contractAddress: meta.contractAddress },
                  'Background refresh: Failed to cache token metadata'
                );
              });
            }
          }
        }
      })
      .catch((error) => {
        this.logger.warn({ error, blockchain, count: staleContracts.length }, 'Background refresh failed');
      });
  }
}
