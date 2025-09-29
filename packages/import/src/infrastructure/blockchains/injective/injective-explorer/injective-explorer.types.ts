export interface InjectiveExplorerResponse {
  data: InjectiveExplorerTransaction[];
  paging?: {
    from?: number;
    to?: number;
    total: number;
  };
}

export interface InjectiveExplorerTransaction {
  block_number: number;
  block_timestamp: string;
  block_unix_timestamp?: number;
  claim_id?: number[];
  code: number;
  codespace?: string;
  data?: string;
  error_log?: string;
  extension_options?: unknown[];
  gas_fee: InjectiveExplorerGasFee;
  gas_used: number;
  gas_wanted: number;
  hash: string;
  id?: string;
  info?: string;
  logs?: InjectiveExplorerTransactionLog[];
  memo?: string;
  messages: InjectiveExplorerMessage[];
  non_critical_extension_options?: unknown[];
  signatures?: unknown[];
  timeout_height?: number;
  tx_number?: number;
  tx_type: string;
}

export interface InjectiveExplorerMessage {
  type: string;
  value: InjectiveExplorerMessageValue;
}

export interface InjectiveExplorerMessageValue {
  amount?: InjectiveExplorerAmount[] | string;
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
  token?: InjectiveExplorerAmount;
  token_contract?: string;
}

export interface InjectiveExplorerAmount {
  amount: string;
  denom: string;
}

export interface InjectiveExplorerGasFee {
  amount: InjectiveExplorerAmount[];
  gas_limit: number;
  granter: string;
  payer: string;
}

export interface InjectiveExplorerBalance {
  amount: string;
  denom: string;
}

export interface InjectiveExplorerBalanceResponse {
  balances: InjectiveExplorerBalance[];
  pagination: {
    next_key?: string;
    total: string;
  };
}

export interface InjectiveExplorerTransactionLog {
  events?: InjectiveExplorerEvent[];
  msg_index?: string;
}

export interface InjectiveExplorerEvent {
  attributes?: InjectiveExplorerEventAttribute[];
  type?: string;
}

export interface InjectiveExplorerEventAttribute {
  index?: boolean;
  key?: string;
  msg_index?: string;
  value?: string;
}
