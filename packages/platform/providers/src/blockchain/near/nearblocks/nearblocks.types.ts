/**
 * TypeScript types for NearBlocks provider
 * Data structures for bundling multi-endpoint API responses
 */

import type {
  NearBlocksActivity,
  NearBlocksFtTransaction,
  NearBlocksReceipt,
  NearBlocksTransaction,
} from './nearblocks.schemas.js';

/**
 * Bundle of all NearBlocks account data from multiple endpoints
 * Indexed by transaction hash for efficient lookup during ingestion
 */
export interface NearBlocksAccountDataPackage {
  /**
   * Map of transaction hash to base transaction data
   * From /v1/account/{account}/txns-only endpoint
   */
  transactions: Map<string, NearBlocksTransaction>;

  /**
   * Map of receipt ID to receipt data
   * From /v1/account/{account}/receipts endpoint
   * Used to correlate activities to transactions
   */
  receipts: Map<string, NearBlocksReceipt>;

  /**
   * Map of transaction hash to array of activities
   * From /v1/account/{account}/activity endpoint
   * Contains NEAR balance deltas (INBOUND/OUTBOUND)
   */
  activities: Map<string, NearBlocksActivity[]>;

  /**
   * Map of transaction hash to array of fungible token transfers
   * From /v1/account/{account}/ft-txns endpoint
   * Contains NEP-141 token transfer data
   */
  ftTransfers: Map<string, NearBlocksFtTransaction[]>;
}

/**
 * Create an empty NearBlocksAccountDataPackage
 */
export function createEmptyAccountDataPackage(): NearBlocksAccountDataPackage {
  return {
    activities: new Map(),
    ftTransfers: new Map(),
    receipts: new Map(),
    transactions: new Map(),
  };
}
