// Moralis API response types
export interface MoralisTransaction {
  block_hash: string;
  block_number: string;
  block_timestamp: Date;
  from_address: string;
  gas: string;
  gas_price: string;
  hash: string;
  input: string;
  nonce: string;
  receipt_contract_address?: string | undefined;
  receipt_cumulative_gas_used: string;
  receipt_gas_used: string;
  receipt_root?: string | undefined;
  receipt_status: string;
  to_address: string;
  transaction_index: string;
  value: string;

  // Augmented fields added by API client for chain-specific context
  _nativeCurrency?: string | undefined;
  _nativeDecimals?: number | undefined;
}

export interface MoralisTokenTransfer {
  address: string;
  block_hash: string;
  block_number: string;
  block_timestamp: Date;
  contract_type: string;
  from_address: string;
  to_address: string;
  token_decimals: string;
  token_logo: string;
  token_name: string;
  token_symbol: string;
  transaction_hash: string;
  value: string;
}

export interface MoralisNativeBalance {
  balance: string;
}

export interface MoralisTransactionResponse {
  cursor?: string | null;
  page: number;
  page_size: number;
  result: MoralisTransaction[];
}

export interface MoralisTokenTransferResponse {
  cursor?: string | null;
  page: number;
  page_size: number;
  result: MoralisTokenTransfer[];
}

export interface MoralisTokenBalance {
  balance: string;
  decimals: number;
  logo?: string | undefined;
  name: string;
  symbol: string;
  token_address: string;
}
