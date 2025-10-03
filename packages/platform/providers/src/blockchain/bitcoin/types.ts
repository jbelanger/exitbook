import type { HDKey } from '@scure/bip32';

export type XpubType = 'xpub' | 'ypub' | 'zpub' | 'address';
export type BipStandard = 'bip44' | 'bip49' | 'bip84';
export type AddressType = 'legacy' | 'segwit' | 'bech32';

export interface BitcoinWalletAddress {
  address: string; // Original user-provided address (xpub or regular)
  addressGap?: number | undefined; // Address gap used for derivation
  addressType?: AddressType | undefined; // Detected address type
  bipStandard?: BipStandard | undefined; // Detected BIP standard
  derivationPath?: string | undefined; // Derivation path used
  derivedAddresses?: string[] | undefined; // Internal derived addresses (if xpub)
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
  blockHeight?: number | undefined;
  blockId?: string | undefined;
  currency: 'BTC';
  // Fee information
  feeAmount?: string | undefined;
  feeCurrency?: string | undefined;

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
  address?: string | undefined; // Address that owns this input
  txid?: string | undefined; // Previous transaction ID
  value: string; // Value in satoshis as string
  vout?: number | undefined; // Previous output index
}

/**
 * Structured Bitcoin output data
 */
export interface BitcoinTransactionOutput {
  address?: string | undefined; // Destination address
  index: number; // Output index
  value: string; // Value in satoshis as string
}
