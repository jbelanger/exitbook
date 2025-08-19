
// Bitcoin-specific type definitions for blockchain API integration

export interface BitcoinTransaction {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: BitcoinInput[];
  vout: BitcoinOutput[];
  hex: string;
  blockhash?: string;
  confirmations: number;
  time?: number;
  blocktime?: number;
  fee?: number;
}

export interface BitcoinInput {
  txid: string;
  vout: number;
  scriptSig: {
    asm: string;
    hex: string;
  };
  sequence: number;
  addresses?: string[];
  value?: number;
}

export interface BitcoinOutput {
  value: number;
  n: number;
  scriptPubKey: {
    asm: string;
    hex: string;
    reqSigs?: number;
    type: string;
    addresses?: string[];
  };
  spent?: boolean;
}

export interface BitcoinUTXO {
  txid: string;
  vout: number;
  address: string;
  account?: string;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  spendable: boolean;
  solvable: boolean;
  safe: boolean;
}

export interface BitcoinAddress {
  address: string;
  scriptPubKey: string;
  ismine: boolean;
  iswatchonly: boolean;
  isscript: boolean;
  iswitness: boolean;
  witness_version?: number;
  witness_program?: string;
  pubkey?: string;
  label?: string;
  ischange?: boolean;
  timestamp?: number;
  hdkeypath?: string;
  hdseedid?: string;
  hdmasterfingerprint?: string;
  labels?: Array<{
    name: string;
    purpose: string;
  }>;
}

export interface BitcoinAddressInfo {
  address: string;
  balance: number;
  totalReceived: number;
  totalSent: number;
  unconfirmedBalance: number;
  unconfirmedTxAppearances: number;
  txAppearances: number;
  transactions: string[];
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

export interface ExtendedPublicKey {
  xpub: string;
  network: 'mainnet' | 'testnet';
  depth: number;
  fingerprint: string;
  childNumber: number;
  chainCode: string;
  publicKey: string;
  path?: string;
}

// Configuration for Bitcoin address derivation from xpub
export interface BitcoinXpubConfig {
  xpub: string;
  derivationPath?: string;
  addressGap?: number; // How many unused addresses to check
  network?: 'mainnet' | 'testnet';
  addressType?: 'legacy' | 'segwit' | 'bech32';
  bipStandard?: 'bip44' | 'bip49' | 'bip84'; // BIP standard for derivation
}

// V2 Types for wallet address management
export type XpubType = 'xpub' | 'ypub' | 'zpub' | 'address';
export type BipStandard = 'bip44' | 'bip49' | 'bip84';
export type AddressType = 'legacy' | 'segwit' | 'bech32';

export interface BitcoinWalletAddress {
  address: string;           // Original user-provided address (xpub or regular)
  type: XpubType;           // Type of address
  derivedAddresses?: string[]; // Internal derived addresses (if xpub)
  bipStandard?: BipStandard;   // Detected BIP standard
  addressType?: AddressType;   // Detected address type
  derivationPath?: string;     // Derivation path used
  addressGap?: number;         // Address gap used for derivation
}

export interface SmartDetectionResult {
  hdNode: any; // HDKey from @scure/bip32
  addressFunction: (pubkey: Buffer) => string;
  bipStandard: BipStandard;
  addressType: AddressType;
}

// Lightweight address info for efficient gap scanning
export interface AddressInfo {
  txCount: number;
  balance: string; // in BTC
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