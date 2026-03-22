/**
 * Substrate blockchain provider exports
 */

export type { SubstrateChainConfig } from './chain-config.interface.js';
export { SUBSTRATE_CHAINS, getSubstrateChainConfig } from './chain-registry.js';
export { SubstrateAddressSchema, SubstrateEventDataSchema, SubstrateTransactionSchema } from './schemas.js';
export type { SubstrateEventData, SubstrateTransaction } from './schemas.js';
export {
  derivePolkadotAddressVariants,
  encodeSS58Address,
  isSamePolkadotAddress,
  isValidSS58Address,
  normalizeSubstrateAccountIdHex,
  parseSubstrateTransactionType,
  trySubstrateAddressToAccountIdHex,
} from './utils.js';
