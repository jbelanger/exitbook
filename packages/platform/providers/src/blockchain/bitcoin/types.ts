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

// BitcoinTransaction, BitcoinTransactionInput, and BitcoinTransactionOutput types
// are now inferred from Zod schemas in schemas.js and exported from there
