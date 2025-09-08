import type { TransactionId } from '@exitbook/core';
import type { Effect } from 'effect';
import { Data } from 'effect';

import type { Transaction } from '../core/aggregates/transaction.aggregate.js';

// Repository-specific errors
export class LoadTransactionError extends Data.TaggedError('LoadTransactionError')<{
  readonly message: string;
  readonly transactionId: TransactionId;
}> {}

export class SaveTransactionError extends Data.TaggedError('SaveTransactionError')<{
  readonly message: string;
  readonly transactionId?: TransactionId;
}> {}

export class IdempotencyCheckError extends Data.TaggedError('IdempotencyCheckError')<{
  readonly idempotencyKey: string;
  readonly message: string;
}> {}

export interface TransactionRepository {
  checkIdempotency(idempotencyKey: string): Effect.Effect<boolean, IdempotencyCheckError>;

  load(transactionId: TransactionId): Effect.Effect<Transaction, LoadTransactionError>;

  save(transaction: Transaction): Effect.Effect<void, SaveTransactionError>;
}
