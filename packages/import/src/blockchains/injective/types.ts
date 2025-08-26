export interface InjectiveApiResponse {
  data: InjectiveTransaction[];
  paging?: {
    from?: number;
    to?: number;
    total: number;
  };
}

export interface InjectiveTransaction {
  block_number: number;
  block_timestamp: string;
  block_unix_timestamp?: number;
  claim_id?: number[];
  code: number;
  codespace?: string;
  data?: string;
  error_log?: string;
  extension_options?: unknown[];
  gas_fee: InjectiveGasFee;
  gas_used: number;
  gas_wanted: number;
  hash: string;
  id?: string;
  info?: string;
  logs?: InjectiveTransactionLog[];
  memo?: string;
  messages: InjectiveMessage[];
  non_critical_extension_options?: unknown[];
  signatures?: unknown[];
  timeout_height?: number;
  tx_number?: number;
  tx_type: string;
}

export interface InjectiveMessage {
  type: string;
  value: InjectiveMessageValue;
}

export interface InjectiveMessageValue {
  amount?: InjectiveAmount[] | string;
  ethereum_receiver?: string;
  from_address?: string;
  injective_receiver?: string;
  memo?: string;
  receiver?: string;
  sender?: string;
  source_channel?: string;
  source_port?: string;
  timeout_height?: unknown;
  timeout_timestamp?: string;
  to_address?: string;
  token?: InjectiveAmount;
  token_contract?: string;
}

export interface InjectiveAmount {
  amount: string;
  denom: string;
}

export interface InjectiveGasFee {
  amount: InjectiveAmount[];
  gas_limit: number;
  granter: string;
  payer: string;
}

export interface InjectiveBalance {
  amount: string;
  denom: string;
}

export interface InjectiveBalanceResponse {
  balances: InjectiveBalance[];
  pagination: {
    next_key?: string;
    total: string;
  };
}

export interface InjectiveTransactionLog {
  events?: InjectiveEvent[];
  msg_index?: string;
}

export interface InjectiveEvent {
  attributes?: InjectiveEventAttribute[];
  type?: string;
}

export interface InjectiveEventAttribute {
  index?: boolean;
  key?: string;
  msg_index?: string;
  value?: string;
}
