/**
 * V3 TypeScript types for NEAR transaction processing
 *
 * These types support the V3 architecture where:
 * - Normalized data from 4 API streams is stored (not raw)
 * - Processor correlates normalized data by receipt_id
 * - Processor aggregates multiple receipts into one transaction per parent hash
 */

import type {
  NearTransactionV3,
  NearReceiptV3 as NearReceiptSchema,
  NearBalanceChangeV3,
  NearTokenTransferV3,
} from '@exitbook/blockchain-providers';

/**
 * NEAR receipt with correlated balance changes and token transfers
 * This is the enriched receipt used by the processor after correlation
 */
export interface NearReceipt {
  receiptId: string;
  transactionHash: string;
  predecessorAccountId: string;
  receiverAccountId: string;
  receiptKind?: string | undefined;
  blockHash?: string | undefined;
  blockHeight?: number | undefined;
  blockTimestamp?: number | undefined;
  executorAccountId?: string | undefined;
  gasBurnt?: string | undefined;
  tokensBurnt?: string | undefined;
  status?: boolean | undefined;
  logs?: string[] | undefined;
  actions?:
    | {
        accessKey?: unknown;
        actionType: string;
        args?: Record<string, unknown> | string | null | undefined;
        beneficiaryId?: string | undefined;
        deposit?: string | undefined;
        gas?: string | undefined;
        methodName?: string | undefined;
        publicKey?: string | undefined;
      }[]
    | undefined;
  /**
   * Balance changes correlated to this receipt
   * Populated during correlation phase
   */
  balanceChanges?: NearBalanceChangeV3[];
  /**
   * Token transfers correlated to this receipt
   * Populated during correlation phase
   */
  tokenTransfers?: NearTokenTransferV3[];
}

/**
 * Group of normalized transaction data for a single transaction hash
 * Used by processor to correlate and aggregate all data for one transaction
 */
export interface RawTransactionGroup {
  /**
   * Base transaction metadata from /txns-only endpoint
   * Should be present for all transactions
   */
  transaction: NearTransactionV3 | undefined;

  /**
   * Receipt execution records from /receipts endpoint
   * A transaction can have multiple receipts
   */
  receipts: NearReceiptSchema[];

  /**
   * Balance changes from /activities endpoint
   * Contains NEAR balance deltas (INBOUND/OUTBOUND)
   */
  activities: NearBalanceChangeV3[];

  /**
   * Token transfers from /ft-txns endpoint
   * Contains NEP-141 token transfer data
   */
  ftTransfers: NearTokenTransferV3[];
}

/**
 * Correlated transaction data after correlation phase
 * Contains transaction metadata and all enriched receipts
 */
export interface CorrelatedTransaction {
  /**
   * Base transaction metadata
   */
  transaction: NearTransactionV3;

  /**
   * Enriched receipts with balance changes and token transfers attached
   */
  receipts: NearReceipt[];
}
