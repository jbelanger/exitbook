// Handler for gaps view command

import type { UniversalTransaction } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { GapsViewParams, GapsViewResult } from './gaps-view-utils.ts';
import { analyzeFeeGaps } from './gaps-view-utils.ts';

/**
 * Handler for viewing data quality gaps.
 */
export class GapsViewHandler {
  constructor(private readonly txRepo: TransactionRepository) {}

  /**
   * Execute the gaps view command.
   */
  async execute(params: GapsViewParams): Promise<Result<GapsViewResult, Error>> {
    try {
      // Default to fees category if not specified
      const category: string = (params.category ?? 'fees') as string;

      // Fetch all transactions
      const transactionsResult = await this.txRepo.getTransactions();

      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      const transactions = transactionsResult.value;

      // Analyze based on category
      switch (category) {
        case 'fees':
          return this.analyzeFees(transactions);
        case 'prices':
          return err(new Error('Price gap analysis not yet implemented'));
        case 'links':
          return err(new Error('Link gap analysis not yet implemented'));
        case 'validation':
          return err(new Error('Validation gap analysis not yet implemented'));
        default:
          return err(new Error(`Unknown gap category: ${category}`));
      }
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  destroy(): void {
    // No cleanup needed
  }

  /**
   * Analyze fee-related gaps.
   */
  private analyzeFees(transactions: UniversalTransaction[]): Result<GapsViewResult, Error> {
    const analysis = analyzeFeeGaps(transactions);

    const result: GapsViewResult = {
      category: 'fees',
      analysis,
    };

    return ok(result);
  }
}
