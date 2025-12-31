/**
 * NEAR blockchain provider exports
 */

// V2 schemas (receipt-based event model)
export * from './schemas.v2.js';

export * from './utils.ts';

// V3 schemas and types (normalized streaming model)
// Export only specific items to avoid conflicts with V2
export {
  NearStreamTypeSchema,
  NearReceiptActionSchema,
  NearTransactionSchema,
  NearReceiptSchema,
  NearBalanceChangeSchema,
  NearTokenTransferSchema,
  NearStreamEventSchema,
} from './schemas.v3.js';

// Export V3 types with V3 suffix to avoid conflicts with V2
export type {
  NearStreamType,
  NearReceiptAction as NearReceiptActionV3,
  NearTransaction as NearTransactionV3,
  NearReceipt as NearReceiptV3,
  NearBalanceChange as NearBalanceChangeV3,
  NearTokenTransfer as NearTokenTransferV3,
  NearStreamEvent,
} from './schemas.v3.js';

// Provider schemas (NearBlocks API responses)
export * from './providers/nearblocks/nearblocks.schemas.js';

// V3 mapper utilities (used by processor)
export * from './providers/nearblocks/mapper-utils.v3.js';

// Additional utility functions (balance transformations)
export { formatNearAccountId, isValidNearAccountId, nearToYoctoNear, yoctoNearToNear } from './utils.js';
