/**
 * NEAR blockchain provider exports
 */

export type { NearChainConfig } from './chain-config.interface.js';
export { NEAR_CHAINS, getNearChainConfig } from './chain-registry.js';
export {
  formatNearAccountId,
  isValidNearAccountId,
  nearToYoctoNear,
  yoctoNearToNear,
  yoctoNearToNearString,
} from './utils.js';

// Schemas and types (normalized streaming model)
export {
  NearStreamTypeSchema,
  NearActionTypeSchema,
  NearReceiptActionSchema,
  NearTransactionSchema,
  NearReceiptSchema,
  NearBalanceChangeCauseSchema,
  NearBalanceChangeSchema,
  NearTokenTransferSchema,
  NearStreamEventSchema,
} from './schemas.js';

export type {
  NearActionType,
  NearBalanceChangeCause,
  NearBalanceChange,
  NearReceipt,
  NearReceiptAction,
  NearTokenTransfer,
  NearTransaction,
  NearStreamEvent,
  NearStreamType,
} from './schemas.js';
