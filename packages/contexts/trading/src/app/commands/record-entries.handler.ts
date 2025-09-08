import {
  Money,
  Currency,
  CurrencySymbol,
  type InvalidMoneyAmountError,
  type CurrencyMismatchError,
} from '@exitbook/core';
import type { EventBusError } from '@exitbook/platform-messaging';
import { EventBus } from '@exitbook/platform-messaging';
import { Effect, pipe, Context } from 'effect';

import type { RecordEntriesCommand } from '../../core/aggregates/transaction.aggregate.js';
import type { InvalidStateError } from '../../core/aggregates/transaction.aggregate.js';
import type { LedgerEntry, UnbalancedEntriesError } from '../../core/index.js';
import type {
  TransactionRepository,
  LoadTransactionError,
  SaveTransactionError,
} from '../../ports/transaction-repository.port.js';

export const TransactionRepositoryTag = Context.GenericTag<TransactionRepository>(
  '@trading/TransactionRepository',
);

// Pure Effect-based command handler (framework-agnostic)
export const recordEntries = (
  command: RecordEntriesCommand,
): Effect.Effect<
  void,
  | LoadTransactionError
  | SaveTransactionError
  | EventBusError
  | InvalidMoneyAmountError
  | InvalidStateError
  | UnbalancedEntriesError
  | CurrencyMismatchError,
  TransactionRepository | EventBus
> =>
  pipe(
    // 1. Safely parse DTO entries into domain objects first
    Effect.forEach(command.entries, (dtoEntry) =>
      pipe(
        Money.of(
          dtoEntry.amount,
          Currency({
            decimals: dtoEntry.decimals,
            name: dtoEntry.currencyName,
            symbol: CurrencySymbol(dtoEntry.currency),
          }),
        ),
        Effect.map(
          (money) =>
            ({
              accountId: dtoEntry.accountId,
              amount: money,
              direction: dtoEntry.direction,
              entryType: dtoEntry.entryType,
            }) as LedgerEntry,
        ),
      ),
    ),

    // If parsing fails, the program stops here and returns the typed error
    Effect.flatMap((validEntries) =>
      pipe(
        // 2. Load the aggregate (returns Effect with typed error)
        TransactionRepositoryTag,
        Effect.flatMap((repo) => repo.load(command.transactionId)),

        // 3. Execute the domain logic (returns Effect with typed error)
        Effect.flatMap((transaction) =>
          pipe(
            transaction.recordEntries(validEntries),
            Effect.map((event) => ({ event, transaction })), // Keep both for next step
          ),
        ),

        // 4. Orchestrate the state change and save
        Effect.flatMap(({ event, transaction }) => {
          const updatedTransaction = transaction.apply(event);
          return pipe(
            TransactionRepositoryTag,
            Effect.flatMap((repo) => repo.save(updatedTransaction)),
            Effect.map(() => event), // Pass the event along for the next step
          );
        }),

        // 5. Publish the event after a successful save
        Effect.tap((event) =>
          pipe(
            EventBus,
            Effect.flatMap((eventBus) => eventBus.publish(event)),
          ),
        ),

        // 6. Return void as expected by the type signature
        Effect.asVoid,
      ),
    ),
  );
