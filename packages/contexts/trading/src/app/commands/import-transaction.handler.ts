import { UnifiedEventBusTag } from '@exitbook/platform-event-bus';
import type { UnifiedEventBus } from '@exitbook/platform-event-bus';
import { Effect, pipe, Context } from 'effect';

import {
  Transaction,
  type ImportTransactionCommand,
} from '../../core/aggregates/transaction.aggregate.js';
import type {
  TransactionRepository,
  IdempotencyCheckError,
  SaveTransactionError,
} from '../../ports/transaction-repository.port.js';

export const TransactionRepositoryTag = Context.GenericTag<TransactionRepository>(
  '@trading/TransactionRepository',
);

// Pure Effect-based command handler (framework-agnostic)
export const importTransaction = (
  command: ImportTransactionCommand,
): Effect.Effect<
  void,
  IdempotencyCheckError | SaveTransactionError | unknown,
  TransactionRepository | UnifiedEventBus
> => {
  const idempotencyKey = `${command.source}:${command.externalId}`;

  return pipe(
    // 1. Check idempotency (returns Effect with typed error)
    TransactionRepositoryTag,
    Effect.flatMap((repo) => repo.checkIdempotency(idempotencyKey)),

    Effect.flatMap((alreadyExists) =>
      alreadyExists
        ? Effect.void // Skip if already imported
        : pipe(
            // 2. Create the import event (returns Effect)
            Transaction.import(command),

            // 3. Build initial transaction state
            Effect.map((event) => {
              const transaction = Transaction.createEmpty().apply(event);
              return { event, transaction };
            }),

            // 4. Save to event store (returns Effect with typed error)
            Effect.flatMap(({ event, transaction }) =>
              pipe(
                TransactionRepositoryTag,
                Effect.flatMap((repo) => repo.save(transaction)),
                Effect.map(() => event), // Pass event for publishing
              ),
            ),

            // 5. Publish the event after successful save
            Effect.tap((event) =>
              pipe(
                UnifiedEventBusTag,
                Effect.flatMap((eventBus) => eventBus.publishExternal('trading.events', event)),
              ),
            ),

            // 6. Return void as expected by the type signature
            Effect.asVoid,
          ),
    ),
  );
};
