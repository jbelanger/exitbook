/**
 * Provider queries - manages provider metadata and coin mappings
 */

import type { Currency } from '@exitbook/core';
import { wrapError } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { PricesDB } from '../database.js';

export interface ProviderRecord {
  id: number;
  name: string;
  display_name: string;
  last_coin_list_sync: string | null;
  coin_list_count: number;
  is_active: boolean;
  metadata: string;
  created_at: string;
  updated_at: string | null;
}

export interface CoinMappingRecord {
  id: number;
  provider_id: number;
  symbol: string;
  coin_id: string;
  coin_name: string;
  priority: number;
  created_at: string;
  updated_at: string | null;
}

export interface CoinMappingInput {
  symbol: string;
  coin_id: string;
  coin_name: string;
  priority?: number | undefined;
}

/**
 * Queries for managing price providers and coin mappings
 */
export function createProviderQueries(db: PricesDB) {
  /**
   * Get or create a provider by name
   */
  async function upsertProvider(name: string, displayName: string): Promise<Result<ProviderRecord, Error>> {
    try {
      // Check if provider exists
      const existing = await db.selectFrom('providers').selectAll().where('name', '=', name).executeTakeFirst();

      if (existing) {
        return ok(existing);
      }

      // Insert new provider
      const result = await db
        .insertInto('providers')
        .values({
          name,
          display_name: displayName,
          is_active: 1 as unknown as boolean, // SQLite uses integers for booleans
          metadata: '{}',
          created_at: new Date().toISOString(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return ok(result);
    } catch (error) {
      return wrapError(error, `Failed to upsert provider`);
    }
  }

  /**
   * Get provider by name
   */
  async function getProviderByName(name: string): Promise<Result<ProviderRecord | undefined, Error>> {
    try {
      const provider = await db.selectFrom('providers').selectAll().where('name', '=', name).executeTakeFirst();

      return ok(provider);
    } catch (error) {
      return wrapError(error, `Failed to get provider`);
    }
  }

  /**
   * Update provider's last sync time and coin count
   */
  async function updateProviderSync(providerId: number, coinCount: number): Promise<Result<void, Error>> {
    try {
      await db
        .updateTable('providers')
        .set({
          last_coin_list_sync: new Date().toISOString(),
          coin_list_count: coinCount,
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', providerId)
        .execute();

      return ok();
    } catch (error) {
      return wrapError(error, `Failed to update provider sync`);
    }
  }

  /**
   * Batch upsert coin mappings for a provider
   */
  async function upsertCoinMappings(providerId: number, mappings: CoinMappingInput[]): Promise<Result<void, Error>> {
    try {
      // Delete existing mappings for this provider
      await db.deleteFrom('provider_coin_mappings').where('provider_id', '=', providerId).execute();

      // Insert new mappings in batches
      const batchSize = 500;
      const createdAt = new Date().toISOString();
      for (let i = 0; i < mappings.length; i += batchSize) {
        const batch = mappings.slice(i, i + batchSize);

        await db
          .insertInto('provider_coin_mappings')
          .values(
            batch.map((mapping) => ({
              provider_id: providerId,
              symbol: mapping.symbol.toUpperCase(),
              coin_id: mapping.coin_id,
              coin_name: mapping.coin_name,
              priority: mapping.priority ?? 0,
              created_at: createdAt,
            }))
          )
          .execute();
      }

      return ok();
    } catch (error) {
      return wrapError(error, `Failed to upsert coin mappings`);
    }
  }

  /**
   * Get coin ID for a symbol from a provider
   */
  async function getCoinIdForSymbol(providerId: number, symbol: Currency): Promise<Result<string | undefined, Error>> {
    try {
      const mapping = await db
        .selectFrom('provider_coin_mappings')
        .select('coin_id')
        .where('provider_id', '=', providerId)
        .where('symbol', '=', symbol.toString())
        .orderBy('priority', 'asc')
        .executeTakeFirst();

      return ok(mapping?.coin_id);
    } catch (error) {
      return wrapError(error, `Failed to get coin ID`);
    }
  }

  /**
   * Get all coin mappings for a provider
   */
  async function getAllCoinMappings(providerId: number): Promise<Result<CoinMappingRecord[], Error>> {
    try {
      const mappings = await db
        .selectFrom('provider_coin_mappings')
        .selectAll()
        .where('provider_id', '=', providerId)
        .execute();

      return ok(mappings);
    } catch (error) {
      return wrapError(error, `Failed to get coin mappings`);
    }
  }

  /**
   * Check if provider needs coin list sync
   * Returns true if never synced or synced more than 7 days ago
   */
  async function needsCoinListSync(providerId: number): Promise<Result<boolean, Error>> {
    try {
      const provider = await db
        .selectFrom('providers')
        .select(['last_coin_list_sync', 'coin_list_count'])
        .where('id', '=', providerId)
        .executeTakeFirst();

      if (!provider) {
        return err(new Error(`Provider ${providerId} not found`));
      }

      // Never synced
      if (!provider.last_coin_list_sync || provider.coin_list_count === 0) {
        return ok(true);
      }

      // Check if stale (older than 7 days)
      const lastSync = new Date(provider.last_coin_list_sync);
      const now = new Date();
      const daysSinceSync = (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60 * 24);

      return ok(daysSinceSync > 7);
    } catch (error) {
      return wrapError(error, `Failed to check sync status`);
    }
  }

  return {
    upsertProvider,
    getProviderByName,
    updateProviderSync,
    upsertCoinMappings,
    getCoinIdForSymbol,
    getAllCoinMappings,
    needsCoinListSync,
  };
}

export type ProviderQueries = ReturnType<typeof createProviderQueries>;
