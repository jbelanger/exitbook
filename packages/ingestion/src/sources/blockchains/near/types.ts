/**
 * TypeScript types for NEAR transaction processing
 *
 * These types support the architecture where:
 * - Normalized data from 4 API streams is stored (not raw)
 * - Processor correlates normalized data by receipt_id
 * - Processor aggregates multiple receipts into one transaction per parent hash
 */

import type {
  NearTransaction,
  NearReceipt as NearReceiptSchema,
  NearBalanceChange,
  NearTokenTransfer,
  NearReceiptAction,
} from '@exitbook/blockchain-providers';

/**
 * NEAR receipt with correlated balance changes and token transfers
 * This is the correlated receipt used by the processor after correlation
 */
export interface NearReceipt {
  receiptId: string;
  transactionHash: string;
  predecessorAccountId: string;
  receiverAccountId: string;
  receiptKind?: string | undefined;
  blockHash?: string | undefined;
  blockHeight?: number | undefined;
  timestamp?: number | undefined;
  executorAccountId?: string | undefined;
  gasBurnt?: string | undefined;
  tokensBurntYocto?: string | undefined;
  status?: boolean | undefined;
  logs?: string[] | undefined;
  actions?: NearReceiptAction[] | undefined;
  /**
   * Balance changes correlated to this receipt
   * Populated during correlation phase
   */
  balanceChanges?: NearBalanceChange[];
  /**
   * Flag indicating this receipt was synthetically created for orphaned data
   * True when balance changes have missing/invalid receipt_id
   */
  isSynthetic?: boolean | undefined;
}

/**
 * Group of normalized transaction data for a single transaction hash
 * Used by processor to correlate and aggregate all data for one transaction
 */
export interface NearTransactionBundle {
  /**
   * Base transaction metadata from /txns-only endpoint
   * Should be present for all transactions
   */
  transaction: NearTransaction | undefined;

  /**
   * Receipt execution records from /receipts endpoint
   * A transaction can have multiple receipts
   */
  receipts: NearReceiptSchema[];

  /**
   * Balance changes from /activities endpoint
   * Contains NEAR balance deltas (INBOUND/OUTBOUND)
   */
  balanceChanges: NearBalanceChange[];

  /**
   * Token transfers from /ft-txns endpoint
   * Contains NEP-141 token transfer data
   */
  tokenTransfers: NearTokenTransfer[];
}

/**
 * Correlated transaction data after correlation phase
 * Contains transaction metadata and all correlated receipts
 */
export interface NearCorrelatedTransaction {
  /**
   * Base transaction metadata
   */
  transaction: NearTransaction;

  /**
   * correlated receipts with balance changes attached
   */
  receipts: NearReceipt[];

  /**
   * Token transfers at transaction-level (not correlated to receipts)
   */
  tokenTransfers: NearTokenTransfer[];
}
