/* eslint-disable unicorn/no-null -- null required for db*/
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { TokenMetadataDB } from './database.js';
import type { TokenMetadata } from './schemas.js';

const logger = getLogger('TokenMetadataCache');

const STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Token metadata cache with persistent storage and background refresh
 */
export class TokenMetadataCache {
  constructor(private db: TokenMetadataDB) {}

  /**
   * Get token metadata by contract address (primary lookup)
   */
  async getByContract(blockchain: string, contractAddress: string): Promise<Result<TokenMetadata | undefined, Error>> {
    try {
      const result = await this.db
        .selectFrom('token_metadata')
        .selectAll()
        .where('blockchain', '=', blockchain)
        .where('contract_address', '=', contractAddress)
        .executeTakeFirst();

      if (!result) {
        logger.debug(`Cache miss - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
        // eslint-disable-next-line unicorn/no-useless-undefined -- undefined indicates not found
        return ok(undefined);
      }

      const metadata: TokenMetadata = {
        blockchain: result.blockchain,
        contractAddress: result.contract_address,
        symbol: result.symbol ?? undefined,
        name: result.name ?? undefined,
        decimals: result.decimals ?? undefined,
        logoUrl: result.logo_url ?? undefined,
        source: result.source,
        updatedAt: new Date(result.updated_at),
        createdAt: new Date(result.created_at),
      };

      logger.debug(
        `Cache hit - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${metadata.symbol ?? 'unknown'}`
      );
      return ok(metadata);
    } catch (error) {
      logger.error({ error }, 'Failed to get token metadata by contract');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get token metadata by symbol (reverse lookup, returns array due to collisions)
   */
  async getBySymbol(blockchain: string, symbol: string): Promise<Result<TokenMetadata[], Error>> {
    try {
      const contracts = await this.db
        .selectFrom('symbol_index')
        .select('contract_address')
        .where('blockchain', '=', blockchain)
        .where('symbol', '=', symbol)
        .execute();

      if (contracts.length === 0) {
        logger.debug(`Cache miss for symbol - Blockchain: ${blockchain}, Symbol: ${symbol}`);
        return ok([]);
      }

      const results: TokenMetadata[] = [];
      for (const { contract_address } of contracts) {
        const metadataResult = await this.getByContract(blockchain, contract_address);
        if (metadataResult.isOk() && metadataResult.value) {
          results.push(metadataResult.value);
        }
      }

      logger.debug(
        `Cache hit for symbol - Blockchain: ${blockchain}, Symbol: ${symbol}, Contracts found: ${results.length}`
      );
      return ok(results);
    } catch (error) {
      logger.error({ error }, 'Failed to get token metadata by symbol');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Set token metadata in cache (upsert)
   */
  async set(
    blockchain: string,
    contractAddress: string,
    metadata: Partial<TokenMetadata>,
    source: string
  ): Promise<Result<void, Error>> {
    try {
      const now = new Date().toISOString();

      await this.db
        .insertInto('token_metadata')
        .values({
          blockchain,
          contract_address: contractAddress,
          symbol: metadata.symbol ?? null,
          name: metadata.name ?? null,
          decimals: metadata.decimals ?? null,
          logo_url: metadata.logoUrl ?? null,
          source,
          updated_at: now,
          created_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['blockchain', 'contract_address']).doUpdateSet({
            symbol: metadata.symbol ?? null,
            name: metadata.name ?? null,
            decimals: metadata.decimals ?? null,
            logo_url: metadata.logoUrl ?? null,
            source,
            updated_at: now,
          })
        )
        .execute();

      if (metadata.symbol) {
        const symbolIndexResult = await this.upsertSymbolIndex(blockchain, metadata.symbol, contractAddress);
        if (symbolIndexResult.isErr()) {
          logger.warn(
            `Failed to update symbol index - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${metadata.symbol}, Error: ${symbolIndexResult.error.message}`
          );
        }
      }

      logger.debug(
        `Cached token metadata - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${metadata.symbol ?? 'unknown'}, Source: ${source}`
      );
      return ok();
    } catch (error) {
      logger.error({ error }, 'Failed to set token metadata');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Check if token metadata is stale (older than 7 days)
   */
  isStale(updatedAt: Date): boolean {
    const now = new Date();
    const ageMs = now.getTime() - updatedAt.getTime();
    return ageMs > STALENESS_THRESHOLD_MS;
  }

  /**
   * Refresh stale token metadata in background (no await)
   * This is called asynchronously when stale data is served
   */
  refreshInBackground(
    blockchain: string,
    contractAddress: string,
    fetchFn: () => Promise<Result<Partial<TokenMetadata>, Error>>,
    source: string
  ): void {
    // Fire and forget - don't block the caller
    (async () => {
      try {
        logger.debug(`Background refresh started - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
        const result = await fetchFn();
        if (result.isOk()) {
          const setResult = await this.set(blockchain, contractAddress, result.value, source);
          if (setResult.isErr()) {
            logger.warn(
              `Background refresh failed to update cache - Blockchain: ${blockchain}, Contract: ${contractAddress}, Error: ${setResult.error.message}`
            );
          } else {
            logger.debug(`Background refresh completed - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
          }
        } else {
          logger.warn(
            `Background refresh failed to fetch data - Blockchain: ${blockchain}, Contract: ${contractAddress}, Error: ${result.error.message}`
          );
        }
      } catch (error) {
        logger.error({ error }, `Background refresh error - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
      }
    })().catch((error) => {
      logger.error(
        { error },
        `Unhandled error in background refresh - Blockchain: ${blockchain}, Contract: ${contractAddress}`
      );
    });
  }

  /**
   * Upsert symbol index entry
   */
  private async upsertSymbolIndex(
    blockchain: string,
    symbol: string,
    contractAddress: string
  ): Promise<Result<void, Error>> {
    try {
      const existing = await this.db
        .selectFrom('symbol_index')
        .selectAll()
        .where('blockchain', '=', blockchain)
        .where('symbol', '=', symbol)
        .where('contract_address', '=', contractAddress)
        .executeTakeFirst();

      if (!existing) {
        await this.db
          .insertInto('symbol_index')
          .values({
            blockchain,
            symbol,
            contract_address: contractAddress,
            created_at: new Date().toISOString(),
          })
          .execute();
      }

      return ok();
    } catch (error) {
      logger.error({ error }, 'Failed to upsert symbol index');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
