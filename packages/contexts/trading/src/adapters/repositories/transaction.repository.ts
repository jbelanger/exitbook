import type { TransactionId } from '@exitbook/core';
import { UnifiedEventBusTag, type UnifiedEventBus } from '@exitbook/platform-event-bus';
import { Effect, Layer, Option, pipe } from 'effect';

import { Transaction } from '../../core/aggregates/transaction.aggregate.js';
import type { IdempotencyCheckError } from '../../ports/transaction-repository.port.js';
import {
  LoadTransactionError,
  SaveTransactionError,
  type TransactionRepository,
  TransactionRepositoryTag,
} from '../../ports/transaction-repository.port.js';

const TRANSACTION_STREAM = 'transaction';

const makeTransactionRepository = (eventBus: UnifiedEventBus): TransactionRepository => ({
  checkIdempotency: (_idempotencyKey: string): Effect.Effect<boolean, IdempotencyCheckError> => {
    // For now, just return false as idempotency is typically handled elsewhere
    // In a real implementation, you might check a dedicated idempotency stream
    return Effect.succeed(false);
  },

  load: (transactionId: TransactionId): Effect.Effect<Transaction, LoadTransactionError> => {
    // For now, we'll return an empty transaction as we need to implement proper event sourcing
    // In a real implementation, this would read from an event stream
    return Effect.succeed(Transaction.createEmpty()).pipe(
      Effect.mapError(
        (error: unknown) =>
          new LoadTransactionError({
            message: `Failed to load transaction: ${String(error)}`,
            transactionId,
          }),
      ),
    );
  },

  save: (transaction: Transaction): Effect.Effect<void, SaveTransactionError> => {
    const uncommittedEvents = transaction.getUncommittedEvents();
    if (uncommittedEvents.length === 0) {
      return Effect.void;
    }

    return pipe(
      transaction.transactionId,
      Option.match({
        onNone: () =>
          Effect.fail(
            new SaveTransactionError({
              message: 'Cannot save transaction without ID',
            }),
          ),
        onSome: (transactionId: TransactionId) => {
          return pipe(
            Effect.forEach(uncommittedEvents, (event) =>
              eventBus.publishExternal(`${TRANSACTION_STREAM}-${transactionId}`, event),
            ),
            Effect.mapError(
              (error: unknown) =>
                new SaveTransactionError({
                  message: `Failed to save transaction: ${String(error)}`,
                  transactionId,
                }),
            ),
            Effect.asVoid,
          );
        },
      }),
      Effect.tap(() => Effect.sync(() => transaction.markEventsAsCommitted())),
    );
  },
});

export const TransactionRepositoryLive = Layer.effect(
  TransactionRepositoryTag,
  Effect.map(UnifiedEventBusTag, makeTransactionRepository),
);
