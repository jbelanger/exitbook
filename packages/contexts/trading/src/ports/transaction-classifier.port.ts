import type { Effect } from 'effect';
import { Context } from 'effect';

import type { TransactionClassification } from '../core/aggregates/transaction.aggregate.js';

export interface RawTransactionData {
  readonly amount?: string;
  readonly currency?: string;
  readonly fee?: string;
  readonly metadata?: Record<string, unknown>;
  readonly source: string;
  readonly type?: string;
}

export interface TransactionClassifier {
  classify(rawData: RawTransactionData): Effect.Effect<TransactionClassification, never>;
}

export const TransactionClassifierTag = Context.GenericTag<TransactionClassifier>(
  '@trading/TransactionClassifier',
);
