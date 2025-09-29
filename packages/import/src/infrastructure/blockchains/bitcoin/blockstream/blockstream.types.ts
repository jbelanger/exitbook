export interface BlockstreamTransaction {
  fee: number;
  locktime: number;
  size: number;
  status: {
    block_hash?: string | undefined;
    block_height?: number | undefined;
    block_time?: number | undefined;
    confirmed: boolean;
  };
  txid: string;
  version: number;
  vin: {
    is_coinbase: boolean;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_address?: string | undefined;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      value: number;
    };
    scriptsig: string;
    scriptsig_asm: string;
    sequence: number;
    txid: string;
    vout: number;
    witness: string[];
  }[];
  vout: {
    scriptpubkey: string;
    scriptpubkey_address?: string | undefined;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    value: number;
  }[];
  weight: number;
}

export interface BlockstreamAddressInfo {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}
