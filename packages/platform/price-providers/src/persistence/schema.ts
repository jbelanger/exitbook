/**
 * Database schema for prices database
 *
 * Separate database from main transactions.db to persist price data
 * across development cycles when transactions.db is dropped
 */

import type { ColumnType } from 'kysely';

/**
 * Provider metadata table
 */
export interface ProvidersTable {
  id: ColumnType<number, never, number>;
  name: string; // e.g., 'coingecko'
  display_name: string; // e.g., 'CoinGecko'
  last_coin_list_sync: string | null; // ISO timestamp
  coin_list_count: ColumnType<number, number | undefined, number>;
  is_active: ColumnType<boolean, boolean | undefined, boolean>;
  metadata: ColumnType<string, string | undefined, string>;
  created_at: ColumnType<string, never, never>;
  updated_at: string | null;
}

/**
 * Provider coin mappings (symbol -> coin ID)
 */
export interface ProviderCoinMappingsTable {
  id: ColumnType<number, never, number>;
  provider_id: number;
  symbol: string; // e.g., 'BTC'
  coin_id: string; // e.g., 'bitcoin' (provider-specific ID)
  coin_name: string; // e.g., 'Bitcoin'
  priority: ColumnType<number, number | undefined, number>;
  created_at: ColumnType<string, never, never>;
  updated_at: string | null;
}

/**
 * Cached price data
 */
export interface PricesTable {
  id: ColumnType<number, never, number>;
  asset_symbol: string; // e.g., 'BTC'
  currency: string; // e.g., 'USD'
  timestamp: string; // ISO timestamp (rounded to day)
  price: string; // Decimal as string
  source_provider: string; // Provider name
  provider_coin_id: string | null; // The coin ID used for this lookup
  fetched_at: string;
  created_at: ColumnType<string, never, never>;
  updated_at: string | null;
}

/**
 * Complete database schema
 */
export interface PricesDatabase {
  providers: ProvidersTable;
  provider_coin_mappings: ProviderCoinMappingsTable;
  prices: PricesTable;
}
