/**
 * NEAR blockchain provider exports
 */

export * from './utils.ts';

// V3 schemas and types (normalized streaming model)
// Export only specific items to avoid conflicts with V2
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

// Export V3 types with V3 suffix to avoid conflicts with V2
export type {
  NearStreamType,
  NearActionType,
  NearReceiptAction as NearReceiptActionV3,
  NearTransaction as NearTransactionV3,
  NearReceipt as NearReceiptV3,
  NearBalanceChangeCause,
  NearBalanceChange as NearBalanceChangeV3,
  NearTokenTransfer as NearTokenTransferV3,
  NearStreamEvent,
} from './schemas.ts';

// Provider schemas (NearBlocks API responses)
export * from './providers/nearblocks/nearblocks.schemas.js';

// V3 mapper utilities (used by processor)
export * from './providers/nearblocks/mapper-utils.ts';

// Additional utility functions (balance transformations)
export { formatNearAccountId, isValidNearAccountId, nearToYoctoNear, yoctoNearToNear } from './utils.js';
