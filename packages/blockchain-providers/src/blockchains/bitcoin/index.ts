/**
 * Bitcoin blockchain provider exports
 */

export type { BitcoinChainConfig } from './chain-config.interface.js';
export { BITCOIN_CHAINS, getBitcoinChainConfig, type BitcoinChainName } from './chain-registry.js';
export { BitcoinAddressSchema, BitcoinTransactionSchema } from './schemas.js';
export type { BitcoinTransaction, BitcoinTransactionInput, BitcoinTransactionOutput } from './schemas.js';
export type {
  AddressType,
  BipStandard,
  BitcoinWalletAddress,
  BitcoinWalletAddressKind,
  SmartDetectionResult,
} from './types.js';
export {
  classifyBitcoinWalletAddress,
  canonicalizeBitcoinAddress,
  deriveBitcoinAddressesFromXpub,
  generateBitcoinTransactionEventId,
  getAddressGenerator,
  getDefaultDerivationPath,
  initializeBitcoinXpubWallet,
  isBitcoinXpub,
  isExtendedPublicKey,
  performBitcoinAddressGapScanning,
  satoshisToBtcString,
  smartDetectBitcoinAccountType,
} from './utils.js';
