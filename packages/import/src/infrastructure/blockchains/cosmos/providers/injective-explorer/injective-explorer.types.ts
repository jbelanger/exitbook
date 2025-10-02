export interface InjectiveExplorerResponse {
  data: InjectiveExplorerTransaction[];
  paging?: {
    from?: number | undefined;
    to?: number | undefined;
    total: number;
  };
}

export interface InjectiveExplorerTransaction {
  block_number: number;
  block_timestamp: string;
  block_unix_timestamp?: number | undefined;
  claim_id?: number[] | undefined;
  code: number;
  codespace?: string | undefined;
  data?: string | undefined;
  error_log?: string | undefined;
  extension_options?: unknown[] | undefined;
  gas_fee: InjectiveExplorerGasFee;
  gas_used: number;
  gas_wanted: number;
  hash: string;
  id?: string | undefined;
  info?: string | undefined;
  logs?: InjectiveExplorerTransactionLog[] | undefined;
  memo?: string | undefined;
  messages: InjectiveExplorerMessage[];
  non_critical_extension_options?: unknown[] | undefined;
  signatures?: unknown[] | undefined;
  timeout_height?: number | undefined;
  tx_number?: number | undefined;
  tx_type: string;
}

export interface InjectiveExplorerMessage {
  type: string;
  value: InjectiveExplorerMessageValue;
}

export interface InjectiveExplorerMessageValue {
  amount?: InjectiveExplorerAmount[] | string | InjectiveExplorerAmount | undefined;
  ethereum_receiver?: string | undefined;
  from_address?: string | undefined;
  injective_receiver?: string | undefined;
  memo?: string | undefined;
  receiver?: string | undefined;
  sender?: string | undefined;
  source_channel?: string | undefined;
  source_port?: string | undefined;
  timeout_height?: unknown;
  timeout_timestamp?: string | undefined;
  to_address?: string | undefined;
  token?: InjectiveExplorerAmount | undefined;
  token_contract?: string | undefined;
  // CosmWasm contract execution fields
  contract?: string | undefined;
  msg?: unknown; // Can be object or JSON string
  funds?: InjectiveExplorerAmount[] | string | undefined; // Array for MsgExecuteContract, string for MsgExecuteContractCompat
  // Peggy bridge withdrawal fields
  eth_dest?: string | undefined;
  bridge_fee?: InjectiveExplorerAmount | undefined;
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
    next_key?: string | undefined;
    total: string;
  };
}

export interface InjectiveExplorerTransactionLog {
  events?: InjectiveExplorerEvent[] | undefined;
  msg_index?: string | undefined;
}

export interface InjectiveExplorerEvent {
  attributes?: InjectiveExplorerEventAttribute[] | undefined;
  type?: string | undefined;
}

export interface InjectiveExplorerEventAttribute {
  index?: boolean | undefined;
  key?: string | undefined;
  msg_index?: string | undefined;
  value?: string | undefined;
}
