/**
 * NEAR native types for correlation and aggregation
 */

import type { NearBalanceChangeCause, NearActionType } from './schemas.js';

/**
 * NEAR receipt action
 */
export interface NearReceiptAction {
  actionType: NearActionType;
  methodName: string | undefined;
  args: Record<string, unknown> | string | null | undefined;
  deposit: string | undefined;
  gas: string | undefined;
  publicKey: string | undefined;
  beneficiaryId: string | undefined;
  accessKey: unknown;
}

/**
 * NEAR balance change
 */
export interface NearBalanceChange {
  transactionHash?: string | undefined;
  receiptId?: string | undefined;
  affectedAccountId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  deltaAmountYocto: string | undefined;
  absoluteNonstakedAmount: string;
  absoluteStakedAmount: string;
  timestamp: number;
  blockHeight: string;
  cause: NearBalanceChangeCause;
  involvedAccountId: string | undefined;
}

/**
 * NEAR token transfer
 */
export interface NearTokenTransfer {
  transactionHash: string;
  affectedAccountId: string;
  contractAddress: string;
  deltaAmountYocto: string | undefined;
  decimals: number;
  symbol: string | undefined;
  name: string | undefined;
  timestamp: number;
  blockHeight: number | undefined;
  cause: string | undefined;
  involvedAccountId: string | undefined;
}

/**
 * NEAR receipt with correlated balance changes and token transfers
 */
export interface NearReceipt {
  receiptId: string;
  transactionHash: string;
  predecessorAccountId: string;
  receiverAccountId: string;
  receiptKind: string | undefined;
  blockHash: string | undefined;
  blockHeight: number | undefined;
  timestamp: number | undefined;
  executorAccountId: string | undefined;
  gasBurnt: string | undefined;
  tokensBurntYocto: string | undefined;
  status: boolean | undefined;
  logs: string[] | undefined;
  actions: NearReceiptAction[] | undefined;
  /**
   * Balance changes correlated to this receipt
   */
  balanceChanges?: NearBalanceChange[];
  /**
   * Token transfers correlated to this receipt
   */
  tokenTransfers?: NearTokenTransfer[];
}
