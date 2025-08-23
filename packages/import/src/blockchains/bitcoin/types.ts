import type { HDKey } from "@scure/bip32";

// Bitcoin provider-specific API response types
export type XpubType = "xpub" | "ypub" | "zpub" | "address";
export type BipStandard = "bip44" | "bip49" | "bip84";
export type AddressType = "legacy" | "segwit" | "bech32";

export interface BitcoinWalletAddress {
  address: string; // Original user-provided address (xpub or regular)
  type: XpubType; // Type of address
  derivedAddresses?: string[]; // Internal derived addresses (if xpub)
  bipStandard?: BipStandard; // Detected BIP standard
  addressType?: AddressType; // Detected address type
  derivationPath?: string; // Derivation path used
  addressGap?: number; // Address gap used for derivation
}

export interface SmartDetectionResult {
  hdNode: HDKey;
  addressFunction: (pubkey: Buffer) => string;
  bipStandard: BipStandard;
  addressType: AddressType;
}

// Lightweight address info for efficient gap scanning
export interface AddressInfo {
  txCount: number;
  balance: string; // in BTC
}

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
