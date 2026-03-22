/**
 * Bitcoin blockchain provider exports
 */

export type { BitcoinChainConfig } from './chain-config.interface.js';
export { BITCOIN_CHAINS, getBitcoinChainConfig, type BitcoinChainName } from './chain-registry.js';
export { BitcoinAddressSchema, BitcoinTransactionSchema } from './schemas.js';
export type { BitcoinTransaction, BitcoinTransactionInput, BitcoinTransactionOutput } from './schemas.js';
export type { AddressType, BipStandard, BitcoinWalletAddress, SmartDetectionResult, XpubType } from './types.js';
export {
  canonicalizeBitcoinAddress,
  deriveBitcoinAddressesFromXpub,
  generateBitcoinTransactionEventId,
  getAddressGenerator,
  getBitcoinAddressType,
  getDefaultDerivationPath,
  initializeBitcoinXpubWallet,
  isBitcoinXpub,
  isExtendedPublicKey,
  performBitcoinAddressGapScanning,
  satoshisToBtcString,
  smartDetectBitcoinAccountType,
} from './utils.js';
