// Blockchain.com API response types
export interface BlockchainComTransaction {
  balance?: number | undefined;
  block_height?: number | null | undefined;
  block_index?: number | null | undefined;
  double_spend: boolean;
  fee: number;
  hash: string;
  inputs: {
    index?: number | undefined;
    prev_out?: {
      addr?: string | undefined;
      n: number;
      script: string;
      spending_outpoints?: { n: number; tx_index: number }[] | undefined;
      spent: boolean;
      tx_index: number;
      type: number;
      value: number;
    };
    script: string;
    sequence?: number | undefined;
    witness?: string | undefined;
  }[];
  lock_time: number;
  out: {
    addr?: string | undefined;
    n: number;
    script: string;
    spending_outpoints?: { n: number; tx_index: number }[] | undefined;
    spent: boolean;
    tx_index: number;
    type: number;
    value: number;
  }[];
  rbf?: boolean | undefined;
  relayed_by: string;
  result: number;
  size: number;
  time: number;
  tx_index: number;
  ver: number;
  vin_sz: number;
  vout_sz: number;
  weight?: number | undefined;
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
