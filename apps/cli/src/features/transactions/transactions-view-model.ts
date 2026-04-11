import type { Result } from '@exitbook/foundation';

import type { CsvFormat, ExportFormat } from './transactions-export-model.js';

/**
 * Per-movement display item (inflow or outflow)
 */
export interface MovementDisplayItem {
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
  sentSummary?: string | undefined;
  receivedSummary?: string | undefined;
  primaryAsset: string | undefined;
  primaryAmount: string | undefined;
  primaryDirection: 'in' | 'out' | undefined;
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
  to: string | undefined;
  notes: { message: string; severity?: string | undefined; type: string }[];
  excludedFromAccounting: boolean;
  isSpam: boolean;
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
  platformFilter?: string | undefined;
  assetFilter?: string | undefined;
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
