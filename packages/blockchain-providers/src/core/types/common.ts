/**
 * Common JSON-RPC response interface for blockchain providers
 */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc?: string;
  id?: string | number;
  result: T;
  error?: {
    code: number;
    message: string;
  };
}

import type { NormalizedTransactionBase } from '../schemas/normalized-transaction.js';

/**
 * Wrapper for a single transaction that includes both raw provider data and normalized data.
 * Used for debugging purposes to retain original provider responses.
 *
 * All normalized transactions must implement NormalizedTransactionBase to ensure
 * consistent identity handling (id and eventId fields).
 */
export interface TransactionWithRawData<TNormalized extends NormalizedTransactionBase = NormalizedTransactionBase> {
  raw: unknown;
  normalized: TNormalized;
}

/**
 * Flexible raw balance data from blockchain providers.
 * Preserves original provider response without forcing conversions.
 * The caller is responsible for converting based on available data.
 *
 * Amount representation:
 * - `rawAmount`: Balance in smallest units (wei, lamports, satoshis, etc.)
 * - `decimalAmount`: Balance in human-readable decimal format
 * - Providers return one or both. Caller converts as needed using `decimals`.
 *
 * Asset identification:
 * - `symbol`: Token symbol (e.g., "ETH", "USDC", "SOL")
 * - `contractAddress`: Token contract/mint address (null for native tokens)
 * - Providers return one or both. Caller resolves as needed.
 *
 * @example Alchemy EVM
 * {
 *   rawAmount: "1234567890000000000",  // wei
 *   symbol: "ETH",
 *   contractAddress: null,
 *   decimals: 18
 * }
 *
 * @example Helius Solana
 * {
 *   rawAmount: "1000000000",  // lamports
 *   decimalAmount: "1.0",
 *   symbol: "SOL",
 *   contractAddress: null,
 *   decimals: 9
 * }
 *
 * @example ERC20 Token
 * {
 *   rawAmount: "5000000",
 *   symbol: "USDC",
 *   contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
 *   decimals: 6
 * }
 */
export interface RawBalanceData {
  /**
   * Balance in smallest units (wei, lamports, satoshis, etc.)
   * Present when provider returns integer amount.
   */
  rawAmount?: string | undefined;

  /**
   * Balance in human-readable decimal format
   * Present when provider returns decimal amount.
   */
  decimalAmount?: string | undefined;

  /**
   * Token symbol (e.g., "ETH", "USDC", "SOL")
   * May be undefined if provider only returns contract address.
   */
  symbol?: string | undefined;

  /**
   * Token contract/mint address
   * Null or undefined for native tokens.
   * Present when provider returns contract address.
   */
  contractAddress?: string | undefined;

  /**
   * Number of decimal places for the token
   * Used to convert between rawAmount and decimalAmount.
   * May be undefined if provider doesn't return decimals.
   */
  decimals?: number | undefined;
}
