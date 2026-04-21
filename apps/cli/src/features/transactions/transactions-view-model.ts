import type { MovementRole } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';

import type { AddressOwnership } from '../shared/address-ownership.js';

import type { CsvFormat, ExportFormat } from './transactions-export-model.js';

/**
 * Per-movement display item (inflow or outflow)
 */
export interface MovementDisplayItem {
  movementFingerprint: string;
  movementRole: MovementRole;
  assetSymbol: string;
  amount: string;
  priceAtTxTime?: { price: string; source: string } | undefined;
}

/**
 * Per-fee display item
 */
export interface FeeDisplayItem {
  assetSymbol: string;
  amount: string;
  scope: string;
  settlement: string;
  priceAtTxTime?: { price: string; source: string } | undefined;
}

export interface TransactionEndpointAccountMatch {
  accountName?: string | undefined;
  accountRef: string;
  platformKey: string;
}

export interface TransactionRelatedContext {
  fromAccount?: TransactionEndpointAccountMatch | undefined;
  openGapRefs?: string[] | undefined;
  sameHashSiblingTransactionCount?: number | undefined;
  sameHashSiblingTransactionRefs?: string[] | undefined;
  sharedFromTransactionCount?: number | undefined;
  sharedFromTransactionRefs?: string[] | undefined;
  sharedToTransactionCount?: number | undefined;
  sharedToTransactionRefs?: string[] | undefined;
  toAccount?: TransactionEndpointAccountMatch | undefined;
}

export interface TransactionSourceLineageItem {
  rawTransactionId: number;
  providerName: string;
  eventId: string;
  timestamp: string;
  processingStatus: 'pending' | 'processed';
  transactionTypeHint?: string | undefined;
  blockchainTransactionHash?: string | undefined;
  sourceAddress?: string | undefined;
}

export interface TransactionSourceDataItem extends TransactionSourceLineageItem {
  providerPayload: unknown;
  normalizedPayload: unknown;
}

/**
 * Per-transaction display item
 */
export interface TransactionViewItem {
  id: number;
  platformKey: string;
  platformKind: 'exchange' | 'blockchain';
  txFingerprint: string;
  datetime: string;
  operationCategory: string;
  operationType: string;
  debitSummary?: string | undefined;
  creditSummary?: string | undefined;
  feeSummary?: string | undefined;
  primaryMovementAsset: string | undefined;
  primaryMovementAmount: string | undefined;
  primaryMovementDirection: 'in' | 'out' | undefined;
  inflows: MovementDisplayItem[];
  outflows: MovementDisplayItem[];
  fees: FeeDisplayItem[];
  priceStatus: 'all' | 'partial' | 'none' | 'not-needed';
  blockchain:
    | {
        blockHeight?: number | undefined;
        isConfirmed: boolean;
        name: string;
        transactionHash: string;
      }
    | undefined;
  from: string | undefined;
  fromOwnership?: AddressOwnership | undefined;
  to: string | undefined;
  toOwnership?: AddressOwnership | undefined;
  annotations: TransactionAnnotation[];
  diagnostics: { code: string; message: string; severity?: string | undefined }[];
  userNotes: { author?: string | undefined; createdAt: string; message: string }[];
  excludedFromAccounting: boolean;
  relatedContext?: TransactionRelatedContext | undefined;
  sourceLineage?: TransactionSourceLineageItem[] | undefined;
  sourceData?: TransactionSourceDataItem[] | undefined;
}

/**
 * Category counts for header
 */
export interface CategoryCounts {
  trade: number;
  transfer: number;
  staking: number;
  other: number;
}

/**
 * Active filters (read-only, applied from CLI args)
 */
export interface TransactionsViewFilters {
  accountFilter?: string | undefined;
  platformFilter?: string | undefined;
  assetFilter?: string | undefined;
  assetIdFilter?: string | undefined;
  addressFilter?: string | undefined;
  fromFilter?: string | undefined;
  toFilter?: string | undefined;
  operationTypeFilter?: string | undefined;
  noPriceFilter?: boolean | undefined;
}

/**
 * Export callback result returned from the entry-point onExport callback.
 */
export interface ExportCallbackResult {
  outputPaths: string[];
  transactionCount: number;
}

/**
 * Callback signature passed from the entry point into the component.
 */
export type OnExport = (
  format: ExportFormat,
  csvFormat: CsvFormat | undefined
) => Promise<Result<ExportCallbackResult, Error>>;
