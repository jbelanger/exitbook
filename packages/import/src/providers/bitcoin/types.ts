// Bitcoin provider-specific API response types

// mempool.space API response types for Bitcoin mainnet
export interface MempoolTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: MempoolInput[];
  vout: MempoolOutput[];
  size: number;
  weight: number;
  fee: number;
  status: MempoolTransactionStatus;
}

export interface MempoolInput {
  txid: string;
  vout: number;
  prevout?: MempoolPrevout;
  scriptsig: string;
  scriptsig_asm: string;
  witness?: string[];
  sequence: number;
}

export interface MempoolPrevout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
}

export interface MempoolOutput {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
}

export interface MempoolTransactionStatus {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

export interface MempoolAddressInfo {
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

export interface MempoolAddressTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: MempoolInput[];
  vout: MempoolOutput[];
  size: number;
  weight: number;
  fee: number;
  status: MempoolTransactionStatus;
}

// blockstream.info API response types for Bitcoin mainnet
export interface BlockstreamTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address?: string;
      value: number;
    };
    scriptsig: string;
    scriptsig_asm: string;
    witness: string[];
    is_coinbase: boolean;
    sequence: number;
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}