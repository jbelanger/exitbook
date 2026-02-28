import type { ColumnType } from '@exitbook/sqlite';

/**
 * Token metadata table - stores token information by contract address.
 */
export interface TokenMetadataTable {
  id: ColumnType<number, never, number>;
  blockchain: string;
  contract_address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  logo_url: string | null;
  // SQLite stores booleans as INTEGER (0/1)
  possible_spam: number | null;
  verified_contract: number | null;
  description: string | null;
  external_url: string | null;
  total_supply: string | null;
  created_at_provider: string | null;
  block_number: number | null;
  source: string;
  refreshed_at: string;
}

/**
 * Symbol index table - enables reverse lookup from symbol to contract addresses.
 */
export interface SymbolIndexTable {
  id: ColumnType<number, never, number>;
  blockchain: string;
  symbol: string;
  contract_address: string;
  created_at: string;
}

/**
 * Complete token metadata database schema.
 */
export interface TokenMetadataDatabase {
  token_metadata: TokenMetadataTable;
  symbol_index: SymbolIndexTable;
}
