import { Effect, pipe } from 'effect';

import type { InvalidStateError } from '../../core/aggregates/transaction.aggregate';
import {
  TransactionClassifierTag,
  type TransactionClassifier,
} from '../../ports/transaction-classifier.port.js';
import {
  TransactionRepositoryTag,
  type TransactionRepository,
  type LoadTransactionError,
  type SaveTransactionError,
} from '../../ports/transaction-repository.port.js';

import type { ClassifyTransactionCommand } from './commands.js';

// Pure Effect-based command handler (framework-agnostic)
export const classifyTransaction = (
  command: ClassifyTransactionCommand,
): Effect.Effect<
  void,
  LoadTransactionError | SaveTransactionError | InvalidStateError | unknown,
  TransactionRepository | TransactionClassifier
> =>
  pipe(
    // 1. Load the aggregate (returns Effect with typed error)
    TransactionRepositoryTag,
    Effect.flatMap((repo) => repo.load(command.transactionId)),

    // 2. Use classifier service to get classification
    Effect.flatMap((transaction) =>
      pipe(
        TransactionClassifierTag,
        Effect.flatMap((classifier) =>
          // In real implementation, we'd get raw data from the transaction
          classifier.classify({ source: 'binance', type: 'trade' }),
        ),
        Effect.flatMap((classification) =>
          // 3. Apply classification to aggregate to get domain event
          transaction.applyClassification(classification),
        ),
        Effect.map((event) => ({ event, transaction })),
      ),
    ),

    // 4. Apply event to get updated state and save
    // The append in repository.save() will automatically handle outbox publishing
    Effect.flatMap(({ event, transaction }) => {
      const updatedTransaction = transaction.apply(event);
      return pipe(
        TransactionRepositoryTag,
        Effect.flatMap((repo) => repo.save(updatedTransaction)),
      );
    }),
  );
