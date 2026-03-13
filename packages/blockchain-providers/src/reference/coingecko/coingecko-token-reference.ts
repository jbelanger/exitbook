import { err, ok, type AssetReferenceStatus, type Result } from '@exitbook/core';
import { HttpClient } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import { z } from 'zod';

import { getBlockchainCatalogEntry } from '../../catalog/blockchains.js';
import type {
  ReferencePlatformMappingRecord,
  TokenMetadataQueries,
  TokenReferenceMatchRecord,
} from '../../persistence/token-metadata/queries.js';

const logger = getLogger('coingecko-token-reference');

const COINGECKO_RATE_LIMITS = {
  demo: {
    burstLimit: 5,
    requestsPerHour: 1800,
    requestsPerMinute: 30,
    requestsPerSecond: 0.5,
  },
  pro: {
    burstLimit: 50,
    requestsPerHour: 30000,
    requestsPerMinute: 500,
    requestsPerSecond: 8.33,
  },
} as const;

const CoinGeckoAssetPlatformSchema = z.object({
  id: z.string(),
  chain_identifier: z.number().int().nullable().optional(),
});

const CoinGeckoAssetPlatformsResponseSchema = z.array(CoinGeckoAssetPlatformSchema);

const CoinGeckoCoinListItemSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  platforms: z.record(z.string(), z.string().nullable()).default({}),
});

const CoinGeckoCoinListResponseSchema = z.array(CoinGeckoCoinListItemSchema);

export interface TokenReferenceLookupResult {
  assetPlatformId?: string | undefined;
  externalAssetId?: string | undefined;
  externalContractAddress?: string | undefined;
  externalName?: string | undefined;
  externalSymbol?: string | undefined;
  provider: string;
  referenceStatus: AssetReferenceStatus;
}

export interface TokenReferenceResolver {
  close(): Promise<void>;
  resolveBatch(
    blockchain: string,
    contractAddresses: string[]
  ): Promise<Result<Map<string, TokenReferenceLookupResult>, Error>>;
}

export interface CoinGeckoTokenReferenceResolverConfig {
  apiKey?: string | undefined;
  useProApi?: boolean | undefined;
}

export function createCoinGeckoTokenReferenceResolver(
  queries: Pick<
    TokenMetadataQueries,
    | 'getReferenceMatches'
    | 'getReferencePlatformMapping'
    | 'isReferencePlatformMappingStale'
    | 'isReferenceStale'
    | 'saveReferenceMatch'
    | 'saveReferencePlatformMapping'
  >,
  config: CoinGeckoTokenReferenceResolverConfig = {}
): Result<TokenReferenceResolver, Error> {
  const apiKey = 'apiKey' in config ? config.apiKey : process.env['COINGECKO_API_KEY'];
  const useProApi = config.useProApi ?? process.env['COINGECKO_USE_PRO_API'] === 'true';
  const headerName = useProApi ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key';

  try {
    const httpClient = new HttpClient({
      baseUrl: useProApi ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3',
      defaultHeaders: apiKey ? { Accept: 'application/json', [headerName]: apiKey } : { Accept: 'application/json' },
      providerName: 'CoinGeckoTokenReference',
      rateLimit: useProApi ? COINGECKO_RATE_LIMITS.pro : COINGECKO_RATE_LIMITS.demo,
      retries: 2,
      service: 'price',
      timeout: 10000,
    });

    return ok(new CoinGeckoTokenReferenceResolver(queries, httpClient, apiKey));
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

class CoinGeckoTokenReferenceResolver implements TokenReferenceResolver {
  constructor(
    private readonly queries: Pick<
      TokenMetadataQueries,
      | 'getReferenceMatches'
      | 'getReferencePlatformMapping'
      | 'isReferencePlatformMappingStale'
      | 'isReferenceStale'
      | 'saveReferenceMatch'
      | 'saveReferencePlatformMapping'
    >,
    private readonly httpClient: HttpClient,
    private readonly apiKey?: string | undefined
  ) {}

  async close(): Promise<void> {
    await this.httpClient.close();
  }

  async resolveBatch(
    blockchain: string,
    contractAddresses: string[]
  ): Promise<Result<Map<string, TokenReferenceLookupResult>, Error>> {
    const normalizedAddresses = [...new Set(contractAddresses.map((address) => normalizeReferenceLookupKey(address)))];
    const results = new Map<string, TokenReferenceLookupResult>();

    for (const contractAddress of normalizedAddresses) {
      results.set(contractAddress, buildUnknownLookupResult());
    }

    if (normalizedAddresses.length === 0) {
      return ok(results);
    }

    const cachedMatchesResult = await this.queries.getReferenceMatches(blockchain, normalizedAddresses, 'coingecko');
    if (cachedMatchesResult.isErr()) {
      return err(cachedMatchesResult.error);
    }

    const contractsToRefresh: string[] = [];

    for (const contractAddress of normalizedAddresses) {
      const cached = cachedMatchesResult.value.get(contractAddress);
      if (!cached) {
        contractsToRefresh.push(contractAddress);
        continue;
      }

      results.set(contractAddress, mapReferenceMatchToLookup(cached));
      if (this.queries.isReferenceStale(cached.refreshedAt)) {
        contractsToRefresh.push(contractAddress);
      }
    }

    if (contractsToRefresh.length === 0) {
      return ok(results);
    }

    if (!this.apiKey) {
      return ok(results);
    }

    const platformMappingResult = await this.resolvePlatformMapping(blockchain);
    if (platformMappingResult.isErr()) {
      logger.warn({ blockchain, error: platformMappingResult.error }, 'Failed to resolve CoinGecko platform mapping');
      return ok(results);
    }

    const platformMapping = platformMappingResult.value;
    if (!platformMapping) {
      return ok(results);
    }

    const coinListResult = await this.httpClient.get('/coins/list?include_platform=true', {
      schema: CoinGeckoCoinListResponseSchema,
    });
    if (coinListResult.isErr()) {
      logger.warn({ blockchain, error: coinListResult.error }, 'Failed to fetch CoinGecko coin list for references');
      return ok(results);
    }

    const matchesByContract = new Map<string, z.infer<typeof CoinGeckoCoinListItemSchema>>();
    for (const coin of coinListResult.value) {
      const platformAddress = coin.platforms[platformMapping.assetPlatformId];
      if (!platformAddress) {
        continue;
      }

      matchesByContract.set(normalizeReferenceLookupKey(platformAddress), coin);
    }

    for (const contractAddress of contractsToRefresh) {
      const match = matchesByContract.get(contractAddress);
      const externalContractAddress = match?.platforms[platformMapping.assetPlatformId];
      const record: TokenReferenceMatchRecord = match
        ? {
            blockchain,
            contractAddress,
            provider: 'coingecko',
            referenceStatus: 'matched',
            assetPlatformId: platformMapping.assetPlatformId,
            externalAssetId: match.id,
            externalName: match.name,
            externalSymbol: match.symbol,
            externalContractAddress:
              typeof externalContractAddress === 'string'
                ? normalizeReferenceLookupKey(externalContractAddress)
                : undefined,
            refreshedAt: new Date(),
          }
        : {
            blockchain,
            contractAddress,
            provider: 'coingecko',
            referenceStatus: 'unmatched',
            assetPlatformId: platformMapping.assetPlatformId,
            refreshedAt: new Date(),
          };

      const saveResult = await this.queries.saveReferenceMatch(record);
      if (saveResult.isErr()) {
        logger.warn(
          { blockchain, contractAddress, error: saveResult.error },
          'Failed to persist CoinGecko token reference match'
        );
      }

      results.set(contractAddress, mapReferenceMatchToLookup(record));
    }

    return ok(results);
  }

  private async resolvePlatformMapping(
    blockchain: string
  ): Promise<Result<ReferencePlatformMappingRecord | undefined, Error>> {
    const cachedResult = await this.queries.getReferencePlatformMapping(blockchain, 'coingecko');
    if (cachedResult.isErr()) {
      return err(cachedResult.error);
    }

    if (cachedResult.value && !this.queries.isReferencePlatformMappingStale(cachedResult.value.refreshedAt)) {
      return ok(cachedResult.value);
    }

    const platformsResult = await this.httpClient.get('/asset_platforms', {
      schema: CoinGeckoAssetPlatformsResponseSchema,
    });
    if (platformsResult.isErr()) {
      if (cachedResult.value) {
        return ok(cachedResult.value);
      }

      return err(platformsResult.error);
    }

    const coingeckoHints = getBlockchainCatalogEntry(blockchain)?.providerHints?.coingecko;
    if (!coingeckoHints) {
      return ok(cachedResult.value);
    }

    const matchingPlatform = platformsResult.value.find(
      (platform) =>
        (coingeckoHints.chainIdentifier !== undefined &&
          platform.chain_identifier === coingeckoHints.chainIdentifier) ||
        (coingeckoHints.platformId !== undefined &&
          platform.id.trim() !== '' &&
          platform.id.trim().toLowerCase() === coingeckoHints.platformId.toLowerCase())
    );
    if (!matchingPlatform) {
      return ok(cachedResult.value);
    }

    const mapping: ReferencePlatformMappingRecord = {
      blockchain,
      provider: 'coingecko',
      assetPlatformId: matchingPlatform.id,
      chainIdentifier: matchingPlatform.chain_identifier ?? undefined,
      refreshedAt: new Date(),
    };

    const saveResult = await this.queries.saveReferencePlatformMapping(mapping);
    if (saveResult.isErr()) {
      logger.warn({ blockchain, error: saveResult.error }, 'Failed to persist CoinGecko platform mapping');
    }

    return ok(mapping);
  }
}

function buildUnknownLookupResult(): TokenReferenceLookupResult {
  return {
    provider: 'coingecko',
    referenceStatus: 'unknown',
  };
}

function mapReferenceMatchToLookup(record: TokenReferenceMatchRecord): TokenReferenceLookupResult {
  return {
    provider: record.provider,
    referenceStatus: record.referenceStatus,
    assetPlatformId: record.assetPlatformId,
    externalAssetId: record.externalAssetId,
    externalName: record.externalName,
    externalSymbol: record.externalSymbol,
    externalContractAddress: record.externalContractAddress,
  };
}

function normalizeReferenceLookupKey(reference: string): string {
  return reference.startsWith('0x') ? reference.toLowerCase() : reference;
}
