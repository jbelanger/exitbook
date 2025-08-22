export interface InjectiveApiResponse {
  data: InjectiveTransaction[];
  paging?: {
    total: number;
    from?: number;
    to?: number;
  };
}

export interface InjectiveTransaction {
  id: string;
  block_number: number;
  block_timestamp: string;
  hash: string;
  code: number;
  info: string;
  gas_wanted: number;
  gas_used: number;
  gas_fee: InjectiveGasFee;
  tx_type: string;
  messages: InjectiveMessage[];
  signatures: unknown[];
  memo?: string;
  timeout_height: number;
  extension_options: unknown[];
  non_critical_extension_options: unknown[];
}

export interface InjectiveMessage {
  type: string;
  value: InjectiveMessageValue;
}

export interface InjectiveMessageValue {
  from_address?: string;
  to_address?: string;
  amount?: InjectiveAmount[];
  sender?: string;
  receiver?: string;
  source_port?: string;
  source_channel?: string;
  token?: InjectiveAmount;
  timeout_height?: unknown;
  timeout_timestamp?: string;
  memo?: string;
}

export interface InjectiveAmount {
  denom: string;
  amount: string;
}

export interface InjectiveGasFee {
  amount: InjectiveAmount[];
  gas_limit: number;
  payer: string;
  granter: string;
}

export interface InjectiveBalance {
  denom: string;
  amount: string;
}

export interface InjectiveBalanceResponse {
  balances: InjectiveBalance[];
  pagination: {
    next_key?: string;
    total: string;
  };
}