/**
 * Shared CCXT type definitions used across multiple exchange adapters
 *
 * These types define common structures used by CCXT-based adapters
 * for balance information and other shared data.
 */

export interface CcxtBalanceInfo {
  free?: number;
  total?: number;
  used?: number;
}

export interface CcxtBalances {
  [currency: string]: CcxtBalanceInfo | unknown; // unknown for 'info' and other metadata fields
}
