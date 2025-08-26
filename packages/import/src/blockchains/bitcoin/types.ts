import type { HDKey } from '@scure/bip32';

export type XpubType = 'xpub' | 'ypub' | 'zpub' | 'address';
export type BipStandard = 'bip44' | 'bip49' | 'bip84';
export type AddressType = 'legacy' | 'segwit' | 'bech32';

export interface BitcoinWalletAddress {
  address: string; // Original user-provided address (xpub or regular)
  addressGap?: number; // Address gap used for derivation
  addressType?: AddressType; // Detected address type
  bipStandard?: BipStandard; // Detected BIP standard
  derivationPath?: string; // Derivation path used
  derivedAddresses?: string[]; // Internal derived addresses (if xpub)
  type: XpubType; // Type of address
}

export interface SmartDetectionResult {
  addressFunction: (pubkey: Buffer) => string;
  addressType: AddressType;
  bipStandard: BipStandard;
  hdNode: HDKey;
}

// Lightweight address info for efficient gap scanning
export interface AddressInfo {
  balance: string; // in BTC
  txCount: number;
}

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

export type BitcoinTransaction = (
  | MempoolTransaction
  | BlockstreamTransaction
  | BlockCypherTransaction
  | BlockchainComTransaction
) & {
  fetchedByAddress?: string;
};

export interface MempoolInput {
  prevout?: MempoolPrevout;
  scriptsig: string;
  scriptsig_asm: string;
  sequence: number;
  txid: string;
  vout: number;
  witness?: string[];
}

export interface MempoolPrevout {
  scriptpubkey: string;
  scriptpubkey_address?: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  value: number;
}

export interface MempoolOutput {
  scriptpubkey: string;
  scriptpubkey_address?: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  value: number;
}

export interface MempoolTransactionStatus {
  block_hash?: string;
  block_height?: number;
  block_time?: number;
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

export interface BlockstreamTransaction {
  fee: number;
  locktime: number;
  size: number;
  status: {
    block_hash?: string;
    block_height?: number;
    block_time?: number;
    confirmed: boolean;
  };
  txid: string;
  version: number;
  vin: Array<{
    is_coinbase: boolean;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_address?: string;
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
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_address?: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    value: number;
  }>;
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
  inputs: Array<{
    addresses: string[];
    age: number;
    output_index: number;
    output_value: number;
    prev_hash: string;
    script_type: string;
    sequence: number;
  }>;
  lock_time: number;
  outputs: Array<{
    addresses: string[];
    script: string;
    script_type: string;
    value: number;
  }>;
  preference: string;
  received: string; // ISO 8601 date
  relayed_by: string;
  size: number;
  ver: number;
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
  txrefs?: Array<{
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
  }>;
  unconfirmed_balance: number;
  unconfirmed_n_tx: number;
}

// Blockchain.com API response types
export interface BlockchainComTransaction {
  block_height?: number;
  block_index?: number;
  double_spend: boolean;
  fee: number;
  hash: string;
  inputs: Array<{
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
  }>;
  lock_time: number;
  out: Array<{
    addr?: string;
    n: number;
    script: string;
    spent: boolean;
    tx_index: number;
    type: number;
    value: number;
  }>;
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

export interface BlockchainComBalanceResponse {
  [address: string]: {
    final_balance: number;
    n_tx: number;
    total_received: number;
  };
}
