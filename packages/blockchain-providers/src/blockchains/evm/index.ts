/**
 * EVM blockchain provider exports
 */

export type { EvmChainConfig } from './chain-config.interface.js';
export { EVM_CHAINS, getEvmChainConfig, type EvmChainName } from './chain-registry.js';
export { EvmAddressSchema, EvmTransactionSchema } from './schemas.js';
export type { EvmTransaction } from './schemas.js';
export type { BeaconWithdrawalFields } from './utils.js';
export {
  extractMethodId,
  generateBeaconWithdrawalEventId,
  getTransactionTypeFromFunctionName,
  isValidEvmAddress,
  normalizeEvmAddress,
} from './utils.js';
