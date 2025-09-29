// Blockchain.com API response types
export interface BlockchainComTransaction {
  block_height?: number;
  block_index?: number;
  double_spend: boolean;
  fee: number;
  hash: string;
  inputs: {
    prev_out?: {
      addr?: string;
      n: number;
      script: string;
      spent: boolean;
      tx_index: number;
      type: number;
      value: number;
    };
    script: string;
  }[];
  lock_time: number;
  out: {
    addr?: string;
    n: number;
    script: string;
    spent: boolean;
    tx_index: number;
    type: number;
    value: number;
  }[];
  relayed_by: string;
  result: number;
  size: number;
  time: number;
  tx_index: number;
  ver: number;
  vin_sz: number;
  vout_sz: number;
}

export interface BlockchainComAddressResponse {
  address: string;
  final_balance: number;
  hash160: string;
  n_tx: number;
  total_received: number;
  total_sent: number;
  txs: BlockchainComTransaction[];
}

export type BlockchainComBalanceResponse = Record<
  string,
  {
    final_balance: number;
    n_tx: number;
    total_received: number;
  }
>;
