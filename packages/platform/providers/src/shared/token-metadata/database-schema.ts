import type { ColumnType, Generated } from 'kysely';

/**
 * Database schema definitions for token metadata cache
 * SQLite-compatible design with proper indexing for lookups
 */

export type DateTime = ColumnType<string, string | Date, string>;

/**
 * Token metadata table - stores cached token information by contract address
 */
export interface TokenMetadataTable {
  id: Generated<number>;
  blockchain: string;
  contract_address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  logo_url: string | null;
  source: string;
  updated_at: DateTime;
  created_at: DateTime;
}

/**
 * Symbol index table - enables reverse lookup from symbol to contract addresses
 * Supports multiple contracts with the same symbol
 */
export interface SymbolIndexTable {
  id: Generated<number>;
  blockchain: string;
  symbol: string;
  contract_address: string;
  created_at: DateTime;
}

/**
 * Complete database schema
 */
export interface TokenMetadataDatabase {
  token_metadata: TokenMetadataTable;
  symbol_index: SymbolIndexTable;
}
