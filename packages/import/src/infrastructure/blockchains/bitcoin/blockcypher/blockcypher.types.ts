// BlockCypher API response types
export interface BlockCypherTransaction {
  block_hash: string;
  block_height: number;
  block_index: number;
  confidence: number;
  confirmations: number;
  confirmed: string; // ISO 8601 date
  double_spend: boolean;
  fees: number;
  gas_limit?: number;
  gas_price?: number;
  gas_used?: number;
  hash: string;
  inputs: {
    addresses: string[];
    age: number;
    output_index: number;
    output_value: number;
    prev_hash: string;
    script_type: string;
    sequence: number;
  }[];
  lock_time: number;
  // Pagination properties
  next_inputs?: string | undefined;
  next_outputs?: string | undefined;
  outputs: {
    addresses: string[];
    script: string;
    script_type: string;
    value: number;
  }[];
  preference: string;
  received: string; // ISO 8601 date
  relayed_by: string;
  size: number;
  ver: number;
  vin_sz?: number | undefined;
  vout_sz?: number | undefined;
  vsize: number;
}

export interface BlockCypherAddress {
  address: string;
  balance: number;
  error?: string;
  final_balance: number;
  final_n_tx: number;
  hasMore?: boolean;
  n_tx: number;
  total_received: number;
  total_sent: number;
  txrefs?: {
    block_height: number;
    confirmations: number;
    confirmed: string;
    double_spend: boolean;
    ref_balance: number;
    spent: boolean;
    tx_hash: string;
    tx_input_n: number;
    tx_output_n: number;
    value: number;
  }[];
  unconfirmed_balance: number;
  unconfirmed_n_tx: number;
}
