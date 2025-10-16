// Utilities and types for view transactions command

/**
 * Parameters for view transactions command.
 */
export interface ViewTransactionsParams {
  source?: string | undefined;
  asset?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  operationType?: string | undefined;
  noPrice?: boolean | undefined;
  limit?: number | undefined;
}

/**
 * Transaction info for display.
 */
export interface TransactionInfo {
  id: number;
  source_id: string;
  source_type: 'exchange' | 'blockchain';
  external_id: string | null | undefined;
  transaction_datetime: string;
  operation_category: string | null | undefined;
  operation_type: string | null | undefined;
  movements_primary_asset: string | null | undefined;
  movements_primary_amount: string | null | undefined;
  movements_primary_direction: string | null | undefined;
  price: string | null | undefined;
  price_currency: string | null | undefined;
  from_address: string | null | undefined;
  to_address: string | null | undefined;
  blockchain_transaction_hash: string | null | undefined;
}

/**
 * Result of view transactions command.
 */
export interface ViewTransactionsResult {
  transactions: TransactionInfo[];
  count: number;
}
