/**
 * Constants for Coinbase API data processing
 *
 * These constants define configuration values and settings
 * used for validating and processing Coinbase exchange data.
 */

/**
 * Coinbase API endpoints and configuration
 *
 * Base URLs and endpoint paths for different Coinbase API services
 */
export const API_CONFIG = {
  /**
   * Coinbase Advanced Trade API base URL
   */
  ADVANCED_TRADE_API_BASE_URL: 'https://api.coinbase.com/api/v3',

  /**
   * Coinbase Pro/Exchange API base URL (legacy)
   */
  PRO_API_BASE_URL: 'https://api.exchange.coinbase.com',

  /**
   * Coinbase Track API (Consumer API) v2 base URL
   */
  TRACK_API_BASE_URL: 'https://api.coinbase.com/v2',
} as const;

/**
 * API rate limiting configuration
 */
export const RATE_LIMITS = {
  /**
   * Default requests per second for Advanced Trade API
   */
  ADVANCED_TRADE_API_RPS: 10,

  /**
   * Default requests per second for Track API
   */
  TRACK_API_RPS: 10,
} as const;

/**
 * Transaction type mappings from Coinbase API to internal format
 */
export const TRANSACTION_TYPE_MAPPINGS = {
  buy: 'trade',
  exchange_deposit: 'deposit',
  exchange_withdrawal: 'withdrawal',
  fiat_deposit: 'deposit',
  fiat_withdrawal: 'withdrawal',
  pro_deposit: 'deposit',
  pro_withdrawal: 'withdrawal',
  request: 'deposit',
  sell: 'trade',
  send: 'withdrawal',
  trade: 'trade',
  transfer: 'transfer',
  vault_withdrawal: 'withdrawal',
} as const;

/**
 * Type definitions for constants
 */
export type ApiConfig = typeof API_CONFIG;
export type RateLimits = typeof RATE_LIMITS;
export type TransactionTypeMapping = typeof TRANSACTION_TYPE_MAPPINGS;
