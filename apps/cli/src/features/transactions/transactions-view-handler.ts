// Handler for view transactions command

import { wrapError } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { parseDate } from '../shared/view-utils.js';

import {
  applyTransactionFilters,
  formatTransactionForDisplay,
  type ViewTransactionsParams,
  type ViewTransactionsResult,
} from './transactions-view-utils.js';

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
    let since: number | undefined;
    if (params.since) {
      const sinceResult = parseDate(params.since);
      if (sinceResult.isErr()) {
        return err(sinceResult.error);
      }
      since = Math.floor(sinceResult.value.getTime() / 1000);
    }

    // Build filter object conditionally to avoid passing undefined values
    const filters = {
      ...(params.source && { sourceName: params.source }),
      ...(since && { since }),
      includeExcluded: true, // Show all transactions including scam tokens in view
    };

    // Fetch transactions from repository
    const txResult = await this.txRepo.getTransactions(filters);

    if (txResult.isErr()) {
      return wrapError(txResult.error, 'Failed to fetch transactions');
    }

    let transactions = txResult.value;

    // Apply additional filters
    const filterResult = applyTransactionFilters(transactions, params);
    if (filterResult.isErr()) {
      return err(filterResult.error);
    }
    transactions = filterResult.value;

    // Apply limit
    if (params.limit) {
      transactions = transactions.slice(0, params.limit);
    }

    // Build result
    const result: ViewTransactionsResult = {
      transactions: transactions.map((tx) => formatTransactionForDisplay(tx)),
      count: transactions.length,
    };

    return ok(result);
  }
}
