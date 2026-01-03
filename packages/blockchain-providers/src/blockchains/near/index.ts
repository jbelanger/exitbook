/**
 * NEAR blockchain provider exports
 */

export * from './utils.ts';

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
} from './schemas.ts';

export type {
  NearStreamType,
  NearActionType,
  NearReceiptAction,
  NearTransaction,
  NearReceipt,
  NearBalanceChangeCause,
  NearBalanceChange,
  NearTokenTransfer,
  NearStreamEvent,
} from './schemas.ts';

// Provider schemas (NearBlocks API responses)
export * from './providers/nearblocks/nearblocks.schemas.js';

// Mapper utilities (used by processor)
export * from './providers/nearblocks/mapper-utils.ts';

// Additional utility functions (balance transformations)
export { formatNearAccountId, isValidNearAccountId, nearToYoctoNear, yoctoNearToNear } from './utils.js';
