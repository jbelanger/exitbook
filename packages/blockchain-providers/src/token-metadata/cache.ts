import type { EventBus } from '@exitbook/events';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import { ProviderError } from '../contracts/errors.js';
import type { FailoverExecutionResult } from '../contracts/index.js';
import type { ProviderEvent } from '../events.js';

import type { TokenMetadata, TokenMetadataRecord } from './contracts.js';
import type { TokenMetadataQueries } from './persistence/queries.js';
import { isTokenMetadataStale } from './persistence/staleness-policy.js';

const BATCH_SIZE = 100;

type FetchFn = (
  blockchain: string,
  contractAddresses: string[]
) => Promise<Result<FailoverExecutionResult<TokenMetadata[]>, ProviderError>>;

export interface TokenMetadataCacheLookupOptions {
  allowProviderFetch?: boolean | undefined;
  refreshStale?: boolean | undefined;
}

export class TokenMetadataCache {
  private readonly logger = getLogger('TokenMetadataCache');
  private readonly staleRefreshesInFlight = new Set<string>();

  constructor(
    private readonly queries: TokenMetadataQueries,
    private readonly fetchFn: FetchFn,
    private readonly eventBus?: EventBus<ProviderEvent> | undefined
  ) {}

  async getBatch(
    blockchain: string,
    contractAddresses: string[],
    options: TokenMetadataCacheLookupOptions = {}
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
          if (isTokenMetadataStale(cached.refreshedAt)) {
            staleContracts.push(address);
          }
        } else {
          uncachedContracts.push(address);
        }
      }
    }

    const cacheHits = contractAddresses.length - uncachedContracts.length;

    // Step 2: Batch fetch uncached contracts in chunks
    const allowProviderFetch = options.allowProviderFetch ?? true;
    if (allowProviderFetch && uncachedContracts.length > 0) {
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
    } else if (!allowProviderFetch) {
      for (const addr of uncachedContracts) {
        metadataMap.set(addr, undefined);
      }
    }

    // Step 3: Background refresh for stale contracts (fire and forget)
    if (allowProviderFetch && (options.refreshStale ?? true) && staleContracts.length > 0) {
      this.refreshStaleContracts(blockchain, staleContracts);
    }

    const providerFetches = allowProviderFetch ? uncachedContracts.length : 0;
    const durationMs = Date.now() - startTime;
    this.logger.info(
      { blockchain, total: contractAddresses.length, cached: cacheHits, fetched: providerFetches, durationMs },
      `Batch metadata fetch complete: ${cacheHits} from cache, ${providerFetches} fetched`
    );

    this.eventBus?.emit({
      type: 'provider.metadata.batch.completed',
      blockchain,
      batchSize: contractAddresses.length,
      cacheHits,
      cacheMisses: uncachedContracts.length,
      durationMs,
      providerFetches,
    });

    return ok(metadataMap);
  }

  private refreshStaleContracts(blockchain: string, staleContracts: string[]): void {
    const contractsToRefresh = this.claimStaleRefreshContracts(blockchain, staleContracts);
    if (contractsToRefresh.length === 0) {
      return;
    }

    this.refreshStaleContractsInBatches(blockchain, contractsToRefresh)
      .then((result) => {
        if (result.isErr()) {
          this.logger.warn(
            { error: result.error, blockchain, count: contractsToRefresh.length },
            'Background refresh failed'
          );
        }
      })
      .catch((error) => {
        this.logger.warn({ error, blockchain, count: contractsToRefresh.length }, 'Background refresh failed');
      })
      .finally(() => {
        this.releaseStaleRefreshContracts(blockchain, contractsToRefresh);
      });
  }

  private claimStaleRefreshContracts(blockchain: string, staleContracts: string[]): string[] {
    const contractsToRefresh: string[] = [];
    for (const contractAddress of new Set(staleContracts)) {
      const key = buildRefreshKey(blockchain, contractAddress);
      if (this.staleRefreshesInFlight.has(key)) {
        continue;
      }

      this.staleRefreshesInFlight.add(key);
      contractsToRefresh.push(contractAddress);
    }

    return contractsToRefresh;
  }

  private releaseStaleRefreshContracts(blockchain: string, contractAddresses: string[]): void {
    for (const contractAddress of contractAddresses) {
      this.staleRefreshesInFlight.delete(buildRefreshKey(blockchain, contractAddress));
    }
  }

  private async refreshStaleContractsInBatches(
    blockchain: string,
    staleContracts: string[]
  ): Promise<Result<void, Error>> {
    for (let i = 0; i < staleContracts.length; i += BATCH_SIZE) {
      const batchAddresses = staleContracts.slice(i, i + BATCH_SIZE);
      const fetchResult = await this.fetchFn(blockchain, batchAddresses);
      if (fetchResult.isErr()) {
        return err(fetchResult.error);
      }

      const { data: fetchedMetadata, providerName } = fetchResult.value;
      for (const meta of fetchedMetadata) {
        if (!meta.contractAddress) {
          continue;
        }

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
            'Background refresh: Failed to cache token metadata'
          );
        }
      }
    }

    return ok(undefined);
  }
}

function buildRefreshKey(blockchain: string, contractAddress: string): string {
  return `${blockchain}:${contractAddress}`;
}
