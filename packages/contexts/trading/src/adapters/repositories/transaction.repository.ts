import type { TransactionId, DomainEvent } from '@exitbook/core';
import { UnifiedEventBusTag, type UnifiedEventBus } from '@exitbook/platform-event-bus';
import type { StreamName } from '@exitbook/platform-event-store';
import { Effect, Layer, Option, pipe, Stream, Chunk } from 'effect';

import { Transaction } from '../../core/aggregates/transaction.aggregate.js';
import type { TransactionImported } from '../../core/events/transaction.events.js';
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
    const stream = `${TRANSACTION_STREAM}-${transactionId}` as StreamName;

    return pipe(
      eventBus.read(stream),
      Stream.runCollect,
      Effect.map((events: Chunk.Chunk<DomainEvent>) =>
        Chunk.toArray(events).reduce(
          (transaction: Transaction, event: DomainEvent) => transaction.apply(event),
          Transaction.createEmpty(),
        ),
      ),
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
          const stream = `${TRANSACTION_STREAM}-${transactionId}` as StreamName;
          const expectedVersion = transaction.version;
          const idempotencyKey =
            uncommittedEvents[0]?._tag === 'TransactionImported'
              ? (uncommittedEvents[0] as TransactionImported).data.idempotencyKey
              : undefined;

          return pipe(
            eventBus.append(
              stream,
              uncommittedEvents,
              expectedVersion,
              idempotencyKey ? { idempotencyKey } : {},
            ),
            Effect.asVoid,
            Effect.mapError(
              (error: unknown) =>
                new SaveTransactionError({
                  message: `Failed to save transaction: ${String(error)}`,
                  transactionId,
                }),
            ),
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
