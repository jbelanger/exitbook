/**
 * XRP Ledger blockchain provider module
 *
 * Provides types, schemas, and utilities for working with the XRP Ledger.
 */

export type { XrpChainConfig } from './chain-config.interface.js';
export { XRP_CHAINS, getXrpChainConfig, type XrpChainName } from './chain-registry.js';
export {
  XrpAddressSchema,
  XrpAmountSchema,
  XrpBalanceChangeSchema,
  XrpDropsAmountSchema,
  XrpIssuedCurrencyAmountSchema,
  XrpTransactionSchema,
} from './schemas.js';
export type {
  XrpAddress,
  XrpAmount,
  XrpBalanceChange,
  XrpDropsAmount,
  XrpIssuedCurrencyAmount,
  XrpTransaction,
} from './schemas.js';
export type { XrpLedgerEntryType, XrpTransactionResult, XrpTransactionType } from './types.js';
export {
  dropsToXrpDecimalString,
  isValidXrpAddress,
  normalizeXrpAddress,
  rippleTimeToUnix,
  unixToRippleTime,
  xrpToDrops,
} from './utils.js';
export { toIssuedCurrencyRawBalance, transformXrpBalance } from './balance-utils.js';
