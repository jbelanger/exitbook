/* eslint-disable unicorn/no-null -- null required for db */
import type { TokenMetadataRecord } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { KyselyDB } from '../storage/database.js';

import { BaseRepository } from './base-repository.js';

const STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Repository for token metadata storage and retrieval
 * Stores token information by contract address with symbol indexing for reverse lookups
 */
export class TokenMetadataRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'TokenMetadataRepository');
  }

  /**
   * Get token metadata by contract address (primary lookup)
   */
  async getByContract(
    blockchain: string,
    contractAddress: string
  ): Promise<Result<TokenMetadataRecord | undefined, Error>> {
    try {
      const result = await this.db
        .selectFrom('token_metadata')
        .selectAll()
        .where('blockchain', '=', blockchain)
        .where('contract_address', '=', contractAddress)
        .executeTakeFirst();

      if (!result) {
        this.logger.debug(`Token metadata not found - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
        return ok(undefined);
      }

      const metadata: TokenMetadataRecord = {
        blockchain: result.blockchain,
        contractAddress: result.contract_address,
        symbol: result.symbol ?? undefined,
        name: result.name ?? undefined,
        decimals: result.decimals ?? undefined,
        logoUrl: result.logo_url ?? undefined,
        refreshedAt: new Date(result.refreshed_at),
        source: result.source,
      };

      this.logger.debug(
        `Token metadata found - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${metadata.symbol ?? 'unknown'}`
      );
      return ok(metadata);
    } catch (error) {
      this.logger.error({ error }, 'Failed to get token metadata by contract');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get token metadata by symbol (reverse lookup, returns array due to collisions)
   */
  async getBySymbol(blockchain: string, symbol: string): Promise<Result<TokenMetadataRecord[], Error>> {
    try {
      const contracts = await this.db
        .selectFrom('symbol_index')
        .select('contract_address')
        .where('blockchain', '=', blockchain)
        .where('symbol', '=', symbol)
        .execute();

      if (contracts.length === 0) {
        this.logger.debug(`Token metadata not found for symbol - Blockchain: ${blockchain}, Symbol: ${symbol}`);
        return ok([]);
      }

      const results: TokenMetadataRecord[] = [];
      for (const { contract_address } of contracts) {
        const metadataResult = await this.getByContract(blockchain, contract_address);
        if (metadataResult.isOk() && metadataResult.value) {
          results.push(metadataResult.value);
        }
      }

      this.logger.debug(
        `Token metadata found for symbol - Blockchain: ${blockchain}, Symbol: ${symbol}, Contracts found: ${results.length}`
      );
      return ok(results);
    } catch (error) {
      this.logger.error({ error }, 'Failed to get token metadata by symbol');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Save token metadata (upsert)
   * Merges with existing data - only updates fields that are explicitly provided
   */
  async save(blockchain: string, contractAddress: string, metadata: TokenMetadataRecord): Promise<Result<void, Error>> {
    try {
      const now = this.getCurrentDateTimeForDB();

      // Fetch existing record to merge with new data
      const existingResult = await this.getByContract(blockchain, contractAddress);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }

      const existing = existingResult.value;

      // Merge: use new values if provided, otherwise keep existing (or null for new records)
      const mergedSymbol = metadata.symbol !== undefined ? metadata.symbol : (existing?.symbol ?? null);
      const mergedName = metadata.name !== undefined ? metadata.name : (existing?.name ?? null);
      const mergedDecimals = metadata.decimals !== undefined ? metadata.decimals : (existing?.decimals ?? null);
      const mergedLogoUrl = metadata.logoUrl !== undefined ? metadata.logoUrl : (existing?.logoUrl ?? null);

      await this.db
        .insertInto('token_metadata')
        .values({
          blockchain,
          contract_address: contractAddress,
          symbol: mergedSymbol,
          name: mergedName,
          decimals: mergedDecimals,
          logo_url: mergedLogoUrl,
          source: metadata.source,
          refreshed_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['blockchain', 'contract_address']).doUpdateSet({
            symbol: mergedSymbol,
            name: mergedName,
            decimals: mergedDecimals,
            logo_url: mergedLogoUrl,
            source: metadata.source,
            refreshed_at: now,
          })
        )
        .execute();

      // Remove old symbol index entry if symbol has changed
      if (existing?.symbol && existing.symbol !== mergedSymbol) {
        const deleteResult = await this.deleteSymbolIndex(blockchain, existing.symbol, contractAddress);
        if (deleteResult.isErr()) {
          this.logger.warn(
            `Failed to delete old symbol index - Blockchain: ${blockchain}, Contract: ${contractAddress}, Old Symbol: ${existing.symbol}, Error: ${deleteResult.error.message}`
          );
        }
      }

      // Add new symbol index entry
      if (mergedSymbol) {
        const symbolIndexResult = await this.upsertSymbolIndex(blockchain, mergedSymbol, contractAddress);
        if (symbolIndexResult.isErr()) {
          this.logger.warn(
            `Failed to update symbol index - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${mergedSymbol}, Error: ${symbolIndexResult.error.message}`
          );
        }
      }

      this.logger.debug(
        `Token metadata saved - Blockchain: ${blockchain}, Contract: ${contractAddress}, Symbol: ${mergedSymbol ?? 'unknown'}, Source: ${metadata.source}`
      );
      return ok();
    } catch (error) {
      this.logger.error({ error }, 'Failed to save token metadata');
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
    fetchFn: () => Promise<Result<TokenMetadataRecord, Error>>
  ): void {
    // Fire and forget - don't block the caller
    (async () => {
      try {
        this.logger.debug(`Background refresh started - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
        const result = await fetchFn();
        if (result.isOk()) {
          const saveResult = await this.save(blockchain, contractAddress, result.value);
          if (saveResult.isErr()) {
            this.logger.warn(
              `Background refresh failed to update - Blockchain: ${blockchain}, Contract: ${contractAddress}, Error: ${saveResult.error.message}`
            );
          } else {
            this.logger.debug(`Background refresh completed - Blockchain: ${blockchain}, Contract: ${contractAddress}`);
          }
        } else {
          this.logger.warn(
            `Background refresh failed to fetch data - Blockchain: ${blockchain}, Contract: ${contractAddress}, Error: ${result.error.message}`
          );
        }
      } catch (error) {
        this.logger.error(
          { error },
          `Background refresh error - Blockchain: ${blockchain}, Contract: ${contractAddress}`
        );
      }
    })().catch((error) => {
      this.logger.error(
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
            created_at: this.getCurrentDateTimeForDB(),
          })
          .execute();
      }

      return ok();
    } catch (error) {
      this.logger.error({ error }, 'Failed to upsert symbol index');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Delete symbol index entry for a specific contract and symbol
   */
  private async deleteSymbolIndex(
    blockchain: string,
    symbol: string,
    contractAddress: string
  ): Promise<Result<void, Error>> {
    try {
      await this.db
        .deleteFrom('symbol_index')
        .where('blockchain', '=', blockchain)
        .where('symbol', '=', symbol)
        .where('contract_address', '=', contractAddress)
        .execute();

      return ok();
    } catch (error) {
      this.logger.error({ error }, 'Failed to delete symbol index');
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
