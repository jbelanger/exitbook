import { UnifiedEventBusTag } from '@exitbook/platform-event-bus';
import type { UnifiedEventBus } from '@exitbook/platform-event-bus';
import { Effect, pipe, Context } from 'effect';

import type { ClassifyTransactionCommand, TransactionClassifier } from '../../core';
import type { InvalidStateError } from '../../core/aggregates/transaction.aggregate';
import type {
  TransactionRepository,
  LoadTransactionError,
  SaveTransactionError,
} from '../../ports';
export const TransactionRepositoryTag = Context.GenericTag<TransactionRepository>(
  '@trading/TransactionRepository',
);
export const TransactionClassifierTag = Context.GenericTag<TransactionClassifier>(
  '@trading/TransactionClassifier',
);

// Pure Effect-based command handler (framework-agnostic)
export const classifyTransaction = (
  command: ClassifyTransactionCommand,
): Effect.Effect<
  void,
  LoadTransactionError | SaveTransactionError | InvalidStateError | unknown,
  TransactionRepository | TransactionClassifier | UnifiedEventBus
> =>
  pipe(
    // 1. Load the aggregate (returns Effect with typed error)
    TransactionRepositoryTag,
    Effect.flatMap((repo) => repo.load(command.transactionId)),

    // 2. Execute the domain classification logic
    Effect.flatMap((transaction) =>
      pipe(
        TransactionClassifierTag,
        Effect.flatMap((classifier) =>
          pipe(
            Effect.provideService(transaction.classify(), TransactionClassifierTag, classifier),
            Effect.map((event) => ({ event, transaction })),
          ),
        ),
      ),
    ),

    // 3. Orchestrate the state change and save
    Effect.flatMap(({ event, transaction }) => {
      const updatedTransaction = transaction.apply(event);
      return pipe(
        TransactionRepositoryTag,
        Effect.flatMap((repo) => repo.save(updatedTransaction)),
        Effect.map(() => event), // Pass the event along for the next step
      );
    }),

    // 4. Publish the event after successful save
    Effect.tap((event) =>
      pipe(
        UnifiedEventBusTag,
        Effect.flatMap((eventBus) => eventBus.publishExternal('trading.events', event)),
      ),
    ),

    // 5. Return void as expected by the type signature
    Effect.asVoid,
  );
