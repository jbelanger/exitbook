// Utilities and types for view transactions command

import type { SourceType } from '@exitbook/core';

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
  source_type: SourceType;
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

/**
 * Get direction icon for transaction movement.
 */
export function getDirectionIcon(direction: string | null | undefined): string {
  switch (direction) {
    case 'in':
      return '←';
    case 'out':
      return '→';
    default:
      return '↔';
  }
}

/**
 * Format operation label from category and type.
 */
export function formatOperationLabel(category: string | null | undefined, type: string | null | undefined): string {
  if (category && type) {
    return `${category}/${type}`;
  }
  return 'Unknown';
}

/**
 * Format price information for display.
 */
export function formatPriceInfo(price: string | null | undefined, currency: string | null | undefined): string {
  if (price) {
    return `${price} ${currency || ''}`.trim();
  }
  return 'No price';
}

/**
 * Format a single transaction for text display.
 */
export function formatTransactionForDisplay(tx: TransactionInfo): string {
  const lines: string[] = [];
  const priceInfo = formatPriceInfo(tx.price, tx.price_currency);
  const operationLabel = formatOperationLabel(tx.operation_category, tx.operation_type);

  lines.push(`Transaction #${tx.id}`);
  lines.push(`   Source: ${tx.source_id} (${tx.source_type})`);
  lines.push(`   Date: ${tx.transaction_datetime}`);
  lines.push(`   Operation: ${operationLabel}`);

  if (tx.movements_primary_asset) {
    const directionIcon = getDirectionIcon(tx.movements_primary_direction);
    const amount = tx.movements_primary_amount || '?';
    lines.push(`   Movement: ${directionIcon} ${amount} ${tx.movements_primary_asset}`);
  }

  lines.push(`   Price: ${priceInfo}`);

  if (tx.blockchain_transaction_hash) {
    lines.push(`   Hash: ${tx.blockchain_transaction_hash}`);
  }

  if (tx.from_address || tx.to_address) {
    if (tx.from_address) lines.push(`   From: ${tx.from_address}`);
    if (tx.to_address) lines.push(`   To: ${tx.to_address}`);
  }

  return lines.join('\n');
}

/**
 * Format transactions list for text display.
 */
export function formatTransactionsListForDisplay(transactions: TransactionInfo[], count: number): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Transactions:');
  lines.push('=============================');
  lines.push('');

  if (transactions.length === 0) {
    lines.push('No transactions found.');
  } else {
    for (const tx of transactions) {
      lines.push(formatTransactionForDisplay(tx));
      lines.push('');
    }
  }

  lines.push('=============================');
  lines.push(`Total: ${count} transactions`);

  return lines.join('\n');
}
