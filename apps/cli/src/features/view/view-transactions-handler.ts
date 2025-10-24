// Handler for view transactions command

import type { UniversalTransaction } from '@exitbook/core';
import { computePrimaryMovement, wrapError } from '@exitbook/core';
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

    // Build filter object conditionally to avoid passing undefined values
    const filters = {
      ...(params.source && { sourceId: params.source }),
      ...(since && { since }),
    };

    // Fetch transactions from repository
    const txResult = await this.txRepo.getTransactions(Object.keys(filters).length > 0 ? filters : undefined);

    if (txResult.isErr()) {
      return wrapError(txResult.error, 'Failed to fetch transactions');
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
  private applyFilters(transactions: UniversalTransaction[], params: ViewTransactionsParams): UniversalTransaction[] {
    let filtered = transactions;

    // Filter by until date
    if (params.until) {
      const untilDate = parseDate(params.until);
      filtered = filtered.filter((tx) => new Date(tx.datetime) <= untilDate);
    }

    // Filter by asset
    if (params.asset) {
      filtered = filtered.filter((tx) => {
        const primary = computePrimaryMovement(tx.movements.inflows, tx.movements.outflows);
        return primary?.asset === params.asset;
      });
    }

    // Filter by operation type
    if (params.operationType) {
      filtered = filtered.filter((tx) => tx.operation.type === params.operationType);
    }

    // Filter by no price
    if (params.noPrice) {
      filtered = filtered.filter((tx) => !(tx.movements.inflows?.length === 0 || tx.movements.outflows?.length === 0));
    }

    return filtered;
  }

  /**
   * Format transaction for display.
   */
  private formatTransaction(tx: UniversalTransaction) {
    // Compute primary movement from inflows/outflows
    const primary = computePrimaryMovement(tx.movements.inflows, tx.movements.outflows);

    return {
      id: tx.id,
      external_id: tx.externalId,
      source_id: tx.source,
      source_type: tx.blockchain ? ('blockchain' as const) : ('exchange' as const),
      transaction_datetime: tx.datetime,
      operation_category: tx.operation.category,
      operation_type: tx.operation.type,
      movements_primary_asset: primary?.asset ?? undefined,
      movements_primary_amount: primary?.amount.toFixed() ?? undefined,
      movements_primary_direction: primary?.direction ?? undefined,
      from_address: tx.from,
      to_address: tx.to,
      blockchain_transaction_hash: tx.blockchain?.transaction_hash,
    };
  }
}
