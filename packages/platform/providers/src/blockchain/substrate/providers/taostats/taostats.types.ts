/**
 * Taostats API-specific types for Bittensor network
 */

export interface TaostatsAddress {
  hex: string;
  ss58: string;
}

export interface TaostatsTransactionRaw {
  amount: string;
  block_number: number;
  extrinsic_id: string;
  fee?: string | undefined;
  from: TaostatsAddress;
  id: string;
  network: string;
  timestamp: Date;
  to: TaostatsAddress;
  transaction_hash: string;
}

export interface TaostatsTransaction {
  amount: string;
  block: number;
  block_hash: string;
  block_number: number;
  confirmations: number;
  fee?: string | undefined;
  from: string;
  hash: string;
  success: boolean;
  timestamp: number;
  to: string;
}

/**
 * Augmented raw transaction with chain config data
 * Added by API client to avoid chain config lookups in mapper
 */
export interface TaostatsTransactionAugmented extends TaostatsTransactionRaw {
  _chainDisplayName: string;
  _nativeCurrency: string;
  _nativeDecimals: number;
}

export interface TaostatsTransactionsResponse {
  data?: TaostatsTransaction[];
}

export interface TaostatsAccountData {
  address: TaostatsAddress;
  network: string;
  block_number: number;
  timestamp: string;
  rank: number;
  balance_free: string; // Free balance in rao
  balance_staked: string; // Total staked balance in rao
  balance_staked_alpha_as_tao: string; // Staked in alpha subnet in rao
  balance_staked_root: string; // Staked to root in rao
  balance_total: string; // Total balance in rao
  balance_free_24hr_ago?: string | undefined;
  balance_staked_24hr_ago?: string | undefined;
  balance_staked_alpha_as_tao_24hr_ago?: string | undefined;
  balance_staked_root_24hr_ago?: string | undefined;
  balance_total_24hr_ago?: string | undefined;
  created_on_date: string;
  created_on_network: string;
  coldkey_swap?: string | undefined;
  alpha_balances?: unknown;
  alpha_balances_24hr_ago?: unknown;
}

export interface TaostatsBalanceResponse {
  data?: TaostatsAccountData[];
}
