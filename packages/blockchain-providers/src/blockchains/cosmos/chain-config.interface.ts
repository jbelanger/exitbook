import type { Currency } from '@exitbook/core';

/**
 * Configuration interface for Cosmos SDK-based blockchains
 *
 * This interface defines the chain-specific configuration needed
 * for Cosmos importers and processors to work across all Cosmos SDK chains.
 *
 * All Cosmos SDK chains share:
 * - Cosmos SDK transaction structure
 * - Tendermint consensus
 * - IBC protocol support
 * - Bech32 address format (with different prefixes)
 * - Message-based transactions
 */
export interface CosmosChainConfig {
  /**
   * Bech32 address prefix (e.g., 'inj', 'osmo', 'cosmos', 'terra')
   * Used for address validation and derivation
   */
  bech32Prefix: string;

  /**
   * Cosmos chain ID (e.g., 'injective-1', 'osmosis-1', 'cosmoshub-4')
   * This is the on-chain identifier, different from the friendly chainName
   */
  chainId: string;

  /**
   * Unique identifier for the blockchain (e.g., 'injective', 'osmosis', 'cosmoshub')
   * Used for internal identification and provider selection
   */
  chainName: string;

  /**
   * Human-readable display name (e.g., 'Injective Protocol', 'Osmosis', 'Cosmos Hub')
   */
  displayName: string;

  /**
   * Optional array of block explorer URLs for this chain
   * e.g., ['https://explorer.injective.network']
   */
  explorerUrls?: string[] | undefined;

  /**
   * Symbol for the native currency (e.g., 'INJ', 'OSMO', 'ATOM')
   */
  nativeCurrency: Currency;

  /**
   * Number of decimals for the native currency
   * Common values: 18 (Injective, Evmos), 6 (most Cosmos chains)
   */
  nativeDecimals: number;

  /**
   * Native denomination as used in the blockchain API responses
   * e.g., 'afet' for Fetch.ai (atto-FET), 'uosmo' for Osmosis (micro-OSMO), 'inj' for Injective
   * This is the actual denom string returned by /cosmos/bank/v1beta1/balances
   */
  nativeDenom: string;

  /**
   * Optional array of REST API endpoints for this chain
   * e.g., ['https://lcd.injective.network']
   */
  restEndpoints?: string[] | undefined;

  /**
   * Optional array of RPC endpoints for this chain
   * e.g., ['https://tm.injective.network']
   */
  rpcEndpoints?: string[] | undefined;

  /**
   * Optional event filter configuration for transaction queries
   * Different Cosmos chains index different event types
   *
   * Modern chains (SDK v0.45+): coin_spent.spender / coin_received.receiver
   * Legacy chains: transfer.sender / transfer.recipient
   *
   * If not specified, defaults to modern filters with automatic fallback
   */
  eventFilters?:
    | {
        /** Event filter for incoming transactions (default: 'coin_received.receiver') */
        receiver: string;
        /** Event filter for outgoing transactions (default: 'coin_spent.spender') */
        sender: string;
      }
    | undefined;

  /**
   * Whether the chain's Cosmos REST API supports transaction event indexing
   * for /cosmos/tx/v1beta1/txs queries. If false, REST-based transaction
   * streaming should be disabled for this chain.
   */
  restTxSearchEnabled?: boolean | undefined;
}
