// Handler for view transactions command

import { computePrimaryMovement } from '@exitbook/core';
import type { StoredTransaction } from '@exitbook/data';
import type { TransactionRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { ViewTransactionsParams, ViewTransactionsResult } from './view-transactions-utils.ts';
import { parseDate } from './view-utils.ts';

/**
 * Handler for viewing transactions.
 */
export class ViewTransactionsHandler {
  constructor(private readonly txRepo: TransactionRepository) {}

  /**
   * Execute the view transactions command.
   */
  async execute(params: ViewTransactionsParams): Promise<Result<ViewTransactionsResult, Error>> {
    // Convert since to unix timestamp if provided
    const since = params.since ? Math.floor(parseDate(params.since).getTime() / 1000) : undefined;

    // Fetch transactions from repository
    const txResult = await this.txRepo.getTransactions(params.source, since);

    if (txResult.isErr()) {
      return txResult;
    }

    let transactions = txResult.value;

    // Apply additional filters
    transactions = this.applyFilters(transactions, params);

    // Apply limit
    if (params.limit) {
      transactions = transactions.slice(0, params.limit);
    }

    // Build result
    const result: ViewTransactionsResult = {
      transactions: transactions.map((tx) => this.formatTransaction(tx)),
      count: transactions.length,
    };

    return ok(result);
  }

  destroy(): void {
    // No cleanup needed
  }

  /**
   * Apply filters to transactions.
   */
  private applyFilters(transactions: StoredTransaction[], params: ViewTransactionsParams): StoredTransaction[] {
    let filtered = transactions;

    // Filter by until date
    if (params.until) {
      const untilDate = parseDate(params.until);
      filtered = filtered.filter((tx) => new Date(tx.transaction_datetime) <= untilDate);
    }

    // Filter by asset
    if (params.asset) {
      filtered = filtered.filter((tx) => {
        const primary = computePrimaryMovement(tx.movements_inflows, tx.movements_outflows);
        return primary?.asset === params.asset;
      });
    }

    // Filter by operation type
    if (params.operationType) {
      filtered = filtered.filter((tx) => tx.operation_type === params.operationType);
    }

    // Filter by no price
    if (params.noPrice) {
      filtered = filtered.filter((tx) => !tx.price || tx.price === null);
    }

    return filtered;
  }

  /**
   * Format transaction for display.
   */
  private formatTransaction(tx: StoredTransaction) {
    // Compute primary movement from inflows/outflows
    const primary = computePrimaryMovement(tx.movements_inflows, tx.movements_outflows);

    return {
      id: tx.id,
      source_id: tx.source_id,
      source_type: tx.source_type,
      external_id: tx.external_id,
      transaction_datetime: tx.transaction_datetime,
      operation_category: tx.operation_category,
      operation_type: tx.operation_type,
      movements_primary_asset: primary?.asset ?? undefined,
      movements_primary_amount: primary?.amount.toFixed() ?? undefined,
      movements_primary_direction: primary?.direction ?? undefined,
      price: tx.price,
      price_currency: tx.price_currency,
      from_address: tx.from_address,
      to_address: tx.to_address,
      blockchain_transaction_hash: tx.blockchain_transaction_hash,
    };
  }
}
