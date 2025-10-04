export interface MempoolTransaction {
  fee: number;
  locktime: number;
  size: number;
  status: MempoolTransactionStatus;
  txid: string;
  version: number;
  vin: MempoolInput[];
  vout: MempoolOutput[];
  weight: number;
}

export interface MempoolInput {
  prevout?: MempoolPrevout | undefined;
  scriptsig: string;
  scriptsig_asm: string;
  sequence: number;
  txid: string;
  vout: number;
  witness?: string[] | undefined;
}

export interface MempoolPrevout {
  scriptpubkey: string;
  scriptpubkey_address?: string | undefined;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  value: number;
}

export interface MempoolOutput {
  scriptpubkey: string;
  scriptpubkey_address?: string | undefined;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  value: number;
}

export interface MempoolTransactionStatus {
  block_hash?: string | undefined;
  block_height?: number | undefined;
  block_time?: Date | undefined;
  confirmed: boolean;
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
  fee: number;
  locktime: number;
  size: number;
  status: MempoolTransactionStatus;
  txid: string;
  version: number;
  vin: MempoolInput[];
  vout: MempoolOutput[];
  weight: number;
}
