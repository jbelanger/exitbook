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

/**
 * Normalized Bitcoin transaction with structured input/output data
 * for sophisticated fund flow analysis in the processor
 */
export interface BitcoinTransaction {
  // Block context
  blockHeight?: number;
  blockId?: string;
  currency: 'BTC';
  // Fee information
  feeAmount?: string;
  feeCurrency?: string;

  // Core transaction data
  id: string;
  // Structured input/output data for fund flow analysis
  inputs: BitcoinTransactionInput[];

  outputs: BitcoinTransactionOutput[];
  providerId: string;

  status: 'success' | 'failed' | 'pending';
  timestamp: number;
}

/**
 * Structured Bitcoin input data
 */
export interface BitcoinTransactionInput {
  address?: string; // Address that owns this input
  txid?: string; // Previous transaction ID
  value: string; // Value in satoshis as string
  vout?: number; // Previous output index
}

/**
 * Structured Bitcoin output data
 */
export interface BitcoinTransactionOutput {
  address?: string; // Destination address
  index: number; // Output index
  value: string; // Value in satoshis as string
}

/**
 * Bitcoin fund flow analysis result
 */
export interface BitcoinFundFlow {
  fromAddress?: string;
  isIncoming: boolean;
  isOutgoing: boolean;
  netAmount: string;
  toAddress?: string;
  totalInput: string;
  totalOutput: string;
  walletInput: string;
  walletOutput: string;
}
