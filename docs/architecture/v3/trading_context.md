## Trading Context - Complete Implementation

### 1. Core Domain Layer (Effect-TS)

```typescript
// src/contexts/trading/domain/value-objects/identifiers.vo.ts
import { Brand } from 'effect';
import { v4 as uuidv4 } from 'uuid';

// Trading-specific identifiers only
export type AccountId = string & Brand.Brand<'AccountId'>;
export const AccountId = {
  ...Brand.nominal<AccountId>(),
  generate: (): AccountId => Brand.nominal<AccountId>()(uuidv4()),
};

export type ExternalId = string & Brand.Brand<'ExternalId'>;
export const ExternalId = Brand.nominal<ExternalId>();
```

### 2. Domain Events

```typescript
// src/contexts/trading/domain/events/transaction.events.ts
import { DomainEvent } from '../../../../@core/domain/base/domain-event.base';
import {
  TransactionId,
  UserId,
} from '../../../../@core/domain/common-types/identifiers';
import { AssetId } from '../../../../@core/domain/common-types/asset-id.vo';
import { Money } from '../../../../@core/domain/common-types/money.vo';
import { ExternalId, AccountId } from '../value-objects/identifiers.vo';

// Transaction events
export class TransactionImported extends DomainEvent {
  readonly _tag = 'TransactionImported';

  constructor(
    readonly data: {
      readonly transactionId: TransactionId;
      readonly userId: UserId;
      readonly externalId: ExternalId;
      readonly source: string;
      readonly rawData: unknown;
      readonly idempotencyKey: string;
      readonly importedAt: Date;
    },
  ) {
    super({
      aggregateId: data.transactionId,
      version: 1,
      timestamp: data.importedAt,
    });
  }
}

export class TransactionClassified extends DomainEvent {
  readonly _tag = 'TransactionClassified';

  constructor(
    readonly data: {
      readonly transactionId: TransactionId;
      readonly classification: string;
      readonly confidence: number;
      readonly protocol?: string;
      readonly classifiedAt: Date;
    },
  ) {
    super({
      aggregateId: data.transactionId,
      timestamp: data.classifiedAt,
      version: 1,
    });
  }
}

export class LedgerEntriesRecorded extends DomainEvent {
  readonly _tag = 'LedgerEntriesRecorded';

  constructor(
    readonly data: {
      readonly transactionId: TransactionId;
      readonly entries: ReadonlyArray<{
        readonly accountId: AccountId;
        readonly amount: Money;
        readonly direction: 'DEBIT' | 'CREDIT';
        readonly entryType: string;
      }>;
      readonly recordedAt: Date;
    },
  ) {
    super({
      aggregateId: data.transactionId,
      timestamp: data.recordedAt,
      version: 1,
    });
  }
}

export class TransactionReversed extends DomainEvent {
  readonly _tag = 'TransactionReversed';

  constructor(
    readonly data: {
      readonly transactionId: TransactionId;
      readonly reversalReason: string;
      readonly reversedBy: UserId;
      readonly reversedAt: Date;
    },
  ) {
    super({
      aggregateId: data.transactionId,
      timestamp: data.reversedAt,
      version: 1,
    });
  }
}
```

### 3. Domain Services and Policies

```typescript
// src/contexts/trading/domain/services/ledger-rules.service.ts
import { Effect, ReadonlyArray, pipe } from 'effect';
import {
  Money,
  CurrencyMismatchError,
} from '../../../../@core/domain/common-types/money.vo';
import { Data } from 'effect';

export class UnbalancedEntriesError extends Data.TaggedError(
  'UnbalancedEntriesError',
)<{
  readonly currency: string;
  readonly difference: Money;
}> {}

export class InvalidAccountCombinationError extends Data.TaggedError(
  'InvalidAccountCombinationError',
)<{
  readonly accountType: string;
  readonly assetType: string;
}> {}

export interface LedgerEntry {
  readonly accountId: string;
  readonly amount: Money;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly entryType: string;
}

export class LedgerRules {
  static validateBalance(
    entries: ReadonlyArray<LedgerEntry>,
  ): Effect.Effect<void, UnbalancedEntriesError | CurrencyMismatchError> {
    return pipe(
      Effect.succeed(entries),
      Effect.flatMap((entries) => {
        // Group by currency
        const byCurrency = new Map<string, Money>();

        return Effect.forEach(
          entries,
          (entry) => {
            const currency = entry.amount.currency.symbol;
            const current =
              byCurrency.get(currency) || Money.zero(entry.amount.currency);

            return pipe(
              entry.direction === 'DEBIT'
                ? current.subtract(entry.amount)
                : current.add(entry.amount),
              Effect.map((updated) => {
                byCurrency.set(currency, updated);
                return updated;
              }),
            );
          },
          { concurrency: 'unbounded' },
        ).pipe(
          Effect.flatMap(() => {
            // Check each currency balances to zero
            for (const [currency, balance] of byCurrency) {
              if (!balance.isZero()) {
                return Effect.fail(
                  new UnbalancedEntriesError({
                    currency,
                    difference: balance,
                  }),
                );
              }
            }
            return Effect.void;
          }),
        );
      }),
    );
  }

  static validateAccountTypes(
    entries: ReadonlyArray<LedgerEntry>,
    accountTypes: Map<string, string>,
    assetTypes: Map<string, string>,
  ): Effect.Effect<void, InvalidAccountCombinationError> {
    return Effect.forEach(
      entries,
      (entry) => {
        const accountType = accountTypes.get(entry.accountId);
        const assetType = assetTypes.get(entry.amount.currency.symbol);

        if (!accountType || !assetType) {
          return Effect.void;
        }

        // NFT accounts can only hold NFTs
        if (accountType === 'NFT_WALLET' && assetType !== 'NFT') {
          return Effect.fail(
            new InvalidAccountCombinationError({
              accountType,
              assetType,
            }),
          );
        }

        // LP accounts can only hold LP tokens
        if (accountType === 'DEFI_LP' && assetType !== 'LP_TOKEN') {
          return Effect.fail(
            new InvalidAccountCombinationError({
              accountType,
              assetType,
            }),
          );
        }

        return Effect.void;
      },
      { concurrency: 'unbounded' },
    ).pipe(Effect.asVoid);
  }
}
```

```typescript
// src/contexts/trading/domain/services/transaction-classifier.service.ts
import { Effect, Context, Layer } from 'effect';
import { Data } from 'effect';

export class TransactionClassification extends Data.Class<{
  readonly type: string;
  readonly confidence: number;
  readonly protocol?: string;
  readonly subType?: string;
}> {
  static unknown(): TransactionClassification {
    return new TransactionClassification({
      type: 'UNKNOWN',
      confidence: 0,
    });
  }
}

export interface RawTransactionData {
  readonly source: string;
  readonly type?: string;
  readonly amount?: string;
  readonly currency?: string;
  readonly fee?: string;
  readonly metadata?: Record<string, unknown>;
}

// Service interface
export interface TransactionClassifier {
  classify(
    rawData: RawTransactionData,
  ): Effect.Effect<TransactionClassification, never>;
}

export const TransactionClassifier = Context.GenericTag<TransactionClassifier>(
  'TransactionClassifier',
);

// Implementation
export class RuleBasedTransactionClassifier implements TransactionClassifier {
  constructor(private rules: ClassificationRule[]) {}

  classify(
    rawData: RawTransactionData,
  ): Effect.Effect<TransactionClassification, never> {
    return Effect.sync(() => {
      for (const rule of this.rules) {
        if (rule.matches(rawData)) {
          return rule.classify(rawData);
        }
      }
      return TransactionClassification.unknown();
    });
  }
}

export interface ClassificationRule {
  matches(data: RawTransactionData): boolean;
  classify(data: RawTransactionData): TransactionClassification;
}

// Layer
export const RuleBasedTransactionClassifierLayer = (
  rules: ClassificationRule[],
) =>
  Layer.succeed(
    TransactionClassifier,
    new RuleBasedTransactionClassifier(rules),
  );
```

### 4. Domain Aggregate (Transaction)

```typescript
// src/contexts/trading/domain/aggregates/transaction.aggregate.ts
import { Effect, pipe, ReadonlyArray, Option } from 'effect';
import { Data } from 'effect';
import { EventSourcedAggregate } from '../../../../@core/domain/base/aggregate-root.base';
import { DomainEvent } from '../../../../@core/domain/base/domain-event.base';
import {
  TransactionId,
  UserId,
} from '../../../../@core/domain/common-types/identifiers';
import { ExternalId } from '../value-objects/identifiers.vo';
import {
  TransactionImported,
  TransactionClassified,
  LedgerEntriesRecorded,
  TransactionReversed,
} from '../events/transaction.events';
import { LedgerRules, LedgerEntry } from '../services/ledger-rules.service';
import {
  TransactionClassifier,
  TransactionClassification,
} from '../services/transaction-classifier.service';

// Transaction errors
export class InvalidStateError extends Data.TaggedError('InvalidStateError')<{
  readonly message: string;
}> {}

export class AlreadyReversedError extends Data.TaggedError(
  'AlreadyReversedError',
)<{
  readonly transactionId: TransactionId;
}> {}

// Transaction status enum
export enum TransactionStatus {
  IMPORTED = 'IMPORTED',
  CLASSIFIED = 'CLASSIFIED',
  RECORDED = 'RECORDED',
  REVERSED = 'REVERSED',
}

// Commands
export interface ImportTransactionCommand {
  readonly userId: UserId;
  readonly externalId: ExternalId;
  readonly source: string;
  readonly rawData: unknown;
}

export interface ClassifyTransactionCommand {
  readonly transactionId: TransactionId;
}

export interface RecordEntriesCommand {
  readonly transactionId: TransactionId;
  readonly entries: ReadonlyArray<{
    readonly accountId: string;
    readonly amount: string | number;
    readonly currency: string;
    readonly decimals: number;
    readonly currencyName: string;
    readonly direction: 'DEBIT' | 'CREDIT';
    readonly entryType: string;
  }>;
}

export interface ReverseTransactionCommand {
  readonly transactionId: TransactionId;
  readonly reason: string;
  readonly reversedBy: UserId;
}

// Transaction Aggregate
export class Transaction extends EventSourcedAggregate {
  readonly transactionId: Option.Option<TransactionId>;
  readonly userId: Option.Option<UserId>;
  readonly externalId: Option.Option<ExternalId>;
  readonly status: TransactionStatus;
  readonly classification: Option.Option<TransactionClassification>;
  readonly entries: ReadonlyArray<LedgerEntry>;

  constructor(data: {
    readonly transactionId: Option.Option<TransactionId>;
    readonly userId: Option.Option<UserId>;
    readonly externalId: Option.Option<ExternalId>;
    readonly status: TransactionStatus;
    readonly classification: Option.Option<TransactionClassification>;
    readonly entries: ReadonlyArray<LedgerEntry>;
    readonly version: number;
    readonly events: ReadonlyArray<DomainEvent>;
  }) {
    super({ version: data.version, events: data.events });
    this.transactionId = data.transactionId;
    this.userId = data.userId;
    this.externalId = data.externalId;
    this.status = data.status;
    this.classification = data.classification;
    this.entries = data.entries;
  }

  protected get aggregateId(): Option.Option<string> {
    return this.transactionId;
  }
  // Create empty transaction for reconstruction
  static createEmpty(): Transaction {
    return new Transaction({
      transactionId: Option.none(),
      userId: Option.none(),
      externalId: Option.none(),
      status: TransactionStatus.IMPORTED,
      classification: Option.none(),
      entries: [],
      events: [],
      version: 0,
    });
  }

  // The ONLY place where state transitions happen
  apply(event: DomainEvent): Transaction {
    switch (event._tag) {
      case 'TransactionImported':
        return this.copy({
          transactionId: Option.some(event.data.transactionId),
          userId: Option.some(event.data.userId),
          externalId: Option.some(event.data.externalId),
          status: TransactionStatus.IMPORTED,
          events: [...this.events, event],
        });

      case 'TransactionClassified':
        return this.copy({
          status: TransactionStatus.CLASSIFIED,
          classification: Option.some(
            new TransactionClassification({
              type: event.data.classification,
              confidence: event.data.confidence,
              protocol: event.data.protocol,
            }),
          ),
          events: [...this.events, event],
        });

      case 'LedgerEntriesRecorded':
        return this.copy({
          status: TransactionStatus.RECORDED,
          entries: event.data.entries,
          events: [...this.events, event],
        });

      case 'TransactionReversed':
        return this.copy({
          status: TransactionStatus.REVERSED,
          events: [...this.events, event],
        });

      default:
        return this;
    }
  }

  // Factory method for importing - returns event, not new state
  static import(
    command: ImportTransactionCommand,
  ): Effect.Effect<TransactionImported, never> {
    return Effect.sync(() => {
      const transactionId = TransactionId.generate();
      return new TransactionImported({
        transactionId,
        userId: command.userId,
        externalId: command.externalId,
        source: command.source,
        rawData: command.rawData,
        idempotencyKey: `${command.source}:${command.externalId}`,
        importedAt: new Date(),
      });
    });
  }

  // Classify transaction - returns event only
  classify(): Effect.Effect<
    TransactionClassified,
    InvalidStateError,
    TransactionClassifier
  > {
    if (this.status !== TransactionStatus.IMPORTED) {
      return Effect.fail(
        new InvalidStateError({
          message: 'Transaction already classified',
        }),
      );
    }

    return pipe(
      this.transactionId,
      Effect.fromOption(
        () => new InvalidStateError({ message: 'Transaction ID is missing' }),
      ),
      Effect.flatMap((transactionId) =>
        pipe(
          TransactionClassifier,
          Effect.flatMap((classifier) =>
            // In real implementation, we'd pass the raw data here
            classifier.classify({ source: 'binance', type: 'trade' }),
          ),
          Effect.map(
            (classification) =>
              new TransactionClassified({
                transactionId,
                classification: classification.type,
                confidence: classification.confidence,
                protocol: classification.protocol,
                classifiedAt: new Date(),
              }),
          ),
        ),
      ),
    );
  }

  // Record ledger entries - returns event only
  recordEntries(
    entries: ReadonlyArray<LedgerEntry>,
  ): Effect.Effect<
    LedgerEntriesRecorded,
    InvalidStateError | ReturnType<typeof LedgerRules.validateBalance>
  > {
    if (this.status === TransactionStatus.REVERSED) {
      return Effect.fail(
        new InvalidStateError({
          message: 'Cannot record entries for reversed transaction',
        }),
      );
    }

    if (!Option.isSome(this.classification)) {
      return Effect.fail(
        new InvalidStateError({
          message: 'Transaction must be classified before recording entries',
        }),
      );
    }

    return pipe(
      this.transactionId,
      Effect.fromOption(
        () => new InvalidStateError({ message: 'Transaction ID is missing' }),
      ),
      Effect.flatMap((transactionId) =>
        pipe(
          LedgerRules.validateBalance(entries),
          Effect.map(
            () =>
              new LedgerEntriesRecorded({
                transactionId,
                entries: entries.map((e) => ({
                  accountId: e.accountId,
                  amount: e.amount,
                  direction: e.direction,
                  entryType: e.entryType,
                })),
                recordedAt: new Date(),
              }),
          ),
        ),
      ),
    );
  }

  // Reverse transaction - returns event only
  reverse(
    reason: string,
    reversedBy: UserId,
  ): Effect.Effect<
    TransactionReversed,
    AlreadyReversedError | InvalidStateError
  > {
    if (this.status === TransactionStatus.REVERSED) {
      return Effect.fail(
        new AlreadyReversedError({
          transactionId:
            Option.getOrUndefined(this.transactionId) ||
            TransactionId.generate(),
        }),
      );
    }

    return pipe(
      this.transactionId,
      Effect.fromOption(
        () => new InvalidStateError({ message: 'Transaction ID is missing' }),
      ),
      Effect.map(
        (transactionId) =>
          new TransactionReversed({
            transactionId,
            reversalReason: reason,
            reversedBy,
            reversedAt: new Date(),
          }),
      ),
    );
  }
}
```

### 5. Application Layer (Command Handlers)

```typescript
// src/contexts/trading/application/commands/import-transaction.handler.ts
import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Effect, pipe, Exit, Option, Data } from 'effect';
import {
  Transaction,
  ImportTransactionCommand,
} from '../../domain/aggregates/transaction.aggregate';
import { TransactionRepository } from '../../infrastructure/repositories/transaction.repository';
import { EventStore } from '../../../../infrastructure/event-store/event-store.service';
import { EventBus } from '@nestjs/cqrs';

// Event publishing error
export class PublishEventError extends Data.TaggedError('PublishEventError')<{
  readonly eventType: string;
  readonly message: string;
}> {}

@Injectable()
@CommandHandler(ImportTransactionCommand)
export class ImportTransactionHandler
  implements ICommandHandler<ImportTransactionCommand>
{
  constructor(
    private readonly repository: TransactionRepository,
    private readonly eventStore: EventStore,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: ImportTransactionCommand): Promise<void> {
    const idempotencyKey = `${command.source}:${command.externalId}`;

    // Single, unbroken pipeline from start to finish
    const program = pipe(
      // 1. Check idempotency (returns Effect with typed error)
      this.repository.checkIdempotency(idempotencyKey),

      Effect.flatMap((alreadyExists) =>
        alreadyExists
          ? Effect.void // Skip if already imported
          : pipe(
              // 2. Create the import event (returns Effect)
              Transaction.import(command),

              // 3. Build initial transaction state
              Effect.map((event) => {
                const transaction = Transaction.createEmpty().apply(event);
                return { transaction, event };
              }),

              // 4. Save to event store (returns Effect with typed error)
              Effect.flatMap(({ transaction, event }) =>
                pipe(
                  this.repository.save(transaction),
                  Effect.map(() => event), // Pass event for publishing
                ),
              ),

              // 5. Publish the event after successful save
              Effect.tap((event) =>
                Effect.tryPromise({
                  try: () => this.eventBus.publish(event),
                  catch: (error) =>
                    new PublishEventError({
                      eventType: event._tag,
                      message: `Failed to publish import event: ${error}`,
                    }),
                }),
              ),
            ),
      ),
    );

    // Run the entire program and handle the final exit state
    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      // The cause contains the specific, typed error from anywhere in the pipeline
      const error =
        exit.cause._tag === 'Fail'
          ? exit.cause.error
          : new Error('Unknown error');

      // Re-throw the original typed error - it will be caught by the Exception Filter
      throw error;
    }
  }
}
```

```typescript
// src/contexts/trading/application/commands/record-entries.handler.ts
import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Effect, pipe, Exit, Data } from 'effect';
import { RecordEntriesCommand } from '../../domain/aggregates/transaction.aggregate';
import { TransactionRepository } from '../../infrastructure/repositories/transaction.repository';
import { EventBus } from '@nestjs/cqrs';
import { Money } from '../../../../@core/domain/common-types/money.vo';
import {
  Currency,
  CurrencySymbol,
} from '../../../../@core/domain/common-types/currency.vo';

// Event publishing error
export class PublishEventError extends Data.TaggedError('PublishEventError')<{
  readonly eventType: string;
  readonly message: string;
}> {}

@Injectable()
@CommandHandler(RecordEntriesCommand)
export class RecordEntriesHandler
  implements ICommandHandler<RecordEntriesCommand>
{
  constructor(
    private readonly repository: TransactionRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: RecordEntriesCommand): Promise<void> {
    // This is now one single, unbroken pipeline from start to finish
    const program = pipe(
      // 1. Safely parse DTO entries into domain objects first
      Effect.forEach(command.entries, (dtoEntry) =>
        pipe(
          Money.of(
            dtoEntry.amount,
            Currency({
              symbol: CurrencySymbol(dtoEntry.currency),
              decimals: dtoEntry.decimals,
              name: dtoEntry.currencyName,
            }),
          ),
          Effect.map((money) => ({
            accountId: dtoEntry.accountId,
            amount: money,
            direction: dtoEntry.direction as 'DEBIT' | 'CREDIT',
            entryType: dtoEntry.entryType,
          })),
        ),
      ),
      // If parsing fails, the program stops here and returns the typed error
      Effect.flatMap((validEntries) =>
        pipe(
          // 2. Load the aggregate (returns Effect with typed error)
          this.repository.load(command.transactionId),

          // 3. Execute the domain logic (returns Effect with typed error)
          Effect.flatMap((transaction) =>
            pipe(
              transaction.recordEntries(validEntries),
              Effect.map((event) => ({ transaction, event })), // Keep both for next step
            ),
          ),

          // 4. Orchestrate the state change and save
          Effect.flatMap(({ transaction, event }) => {
            const updatedTransaction = transaction.apply(event);
            return pipe(
              this.repository.save(updatedTransaction), // returns Effect with typed error
              Effect.map(() => event), // Pass the event along for the next step
            );
          }),

          // 5. Publish the event after a successful save
          Effect.tap((event) =>
            Effect.tryPromise({
              try: () => this.eventBus.publish(event),
              catch: (error) =>
                new PublishEventError({
                  eventType: event._tag,
                  message: `Failed to publish event: ${error}`,
                }),
            }),
          ),
        ),
      ),
    );

    // Run the entire program and handle the final exit state
    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      // The cause contains the specific, typed error from anywhere in the pipeline
      const error =
        exit.cause._tag === 'Fail'
          ? exit.cause.error
          : new Error('Unknown error');

      // Re-throw the original typed error - it will be caught by the Exception Filter
      throw error;
    }
  }
}
```

```typescript
// src/contexts/trading/application/commands/classify-transaction.handler.ts
import { Injectable } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Effect, pipe, Exit, Data } from 'effect';
import { ClassifyTransactionCommand } from '../../domain/aggregates/transaction.aggregate';
import { TransactionRepository } from '../../infrastructure/repositories/transaction.repository';
import { EventBus } from '@nestjs/cqrs';
import { TransactionClassifier } from '../../domain/services/transaction-classifier.service';

// Event publishing error
export class PublishEventError extends Data.TaggedError('PublishEventError')<{
  readonly eventType: string;
  readonly message: string;
}> {}

@Injectable()
@CommandHandler(ClassifyTransactionCommand)
export class ClassifyTransactionHandler
  implements ICommandHandler<ClassifyTransactionCommand>
{
  constructor(
    private readonly repository: TransactionRepository,
    private readonly eventBus: EventBus,
    private readonly classifier: TransactionClassifier, // Injected from NestJS DI
  ) {}

  async execute(command: ClassifyTransactionCommand): Promise<void> {
    // Single, unbroken pipeline from start to finish
    const program = pipe(
      // 1. Load the aggregate (returns Effect with typed error)
      this.repository.load(command.transactionId),

      // 2. Execute the domain classification logic with injected service
      Effect.flatMap((transaction) =>
        pipe(
          transaction.classify(),
          Effect.provideService(TransactionClassifier, this.classifier), // Provide the required service
          Effect.map((event) => ({ transaction, event })), // Keep both for next step
        ),
      ),

      // 3. Orchestrate the state change and save
      Effect.flatMap(({ transaction, event }) => {
        const updatedTransaction = transaction.apply(event);
        return pipe(
          this.repository.save(updatedTransaction), // returns Effect with typed error
          Effect.map(() => event), // Pass the event along for the next step
        );
      }),

      // 4. Publish the event after successful save
      Effect.tap((event) =>
        Effect.tryPromise({
          try: () => this.eventBus.publish(event),
          catch: (error) =>
            new PublishEventError({
              eventType: event._tag,
              message: `Failed to publish classification event: ${error}`,
            }),
        }),
      ),
    );

    // Run the entire program and handle the final exit state
    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      // The cause contains the specific, typed error from anywhere in the pipeline
      const error =
        exit.cause._tag === 'Fail'
          ? exit.cause.error
          : new Error('Unknown error');

      // Re-throw the original typed error - it will be caught by the Exception Filter
      throw error;
    }
  }
}
```

### 6. Infrastructure Layer

```typescript
// src/contexts/trading/infrastructure/repositories/transaction.repository.ts
import { Injectable } from '@nestjs/common';
import { EventStore } from '../../../../infrastructure/event-store/event-store.service';
import {
  Transaction,
  TransactionStatus,
} from '../../domain/aggregates/transaction.aggregate';
import { Option, Effect, pipe, Data } from 'effect';
import { TransactionId } from '../../../../@core/domain/common-types/identifiers';

// Repository-specific errors
export class LoadTransactionError extends Data.TaggedError(
  'LoadTransactionError',
)<{
  readonly transactionId: TransactionId;
  readonly message: string;
}> {}

export class SaveTransactionError extends Data.TaggedError(
  'SaveTransactionError',
)<{
  readonly transactionId?: TransactionId;
  readonly message: string;
}> {}

export class IdempotencyCheckError extends Data.TaggedError(
  'IdempotencyCheckError',
)<{
  readonly idempotencyKey: string;
  readonly message: string;
}> {}

@Injectable()
export class TransactionRepository {
  constructor(private readonly eventStore: EventStore) {}

  // Returns a description of how to load, not the result itself
  load(
    transactionId: TransactionId,
  ): Effect.Effect<Transaction, LoadTransactionError> {
    return pipe(
      Effect.tryPromise({
        try: () => this.eventStore.readStream(transactionId),
        catch: (error) =>
          new LoadTransactionError({
            transactionId,
            message: `Failed to read event stream: ${error}`,
          }),
      }),
      Effect.map((events) =>
        events.reduce(
          (aggregate, event) => aggregate.apply(event),
          Transaction.createEmpty(),
        ),
      ),
    );
  }

  // Returns a description of how to save, not the result itself
  save(transaction: Transaction): Effect.Effect<void, SaveTransactionError> {
    const uncommittedEvents = transaction.getUncommittedEvents();

    if (uncommittedEvents.length === 0) {
      return Effect.void;
    }

    return pipe(
      transaction.transactionId,
      Effect.fromOption(
        () =>
          new SaveTransactionError({
            message: 'Transaction ID is missing for save operation',
          }),
      ),
      Effect.flatMap((transactionId) =>
        Effect.tryPromise({
          try: () =>
            this.eventStore.append(
              transactionId,
              uncommittedEvents,
              transaction.version,
            ),
          catch: (error) =>
            new SaveTransactionError({
              transactionId,
              message: `Failed to save events: ${error}`,
            }),
        }),
      ),
    );
  }

  // Check idempotency without side effects
  checkIdempotency(
    idempotencyKey: string,
  ): Effect.Effect<boolean, IdempotencyCheckError> {
    return Effect.tryPromise({
      try: async () => {
        const existing =
          await this.eventStore.findByIdempotencyKey(idempotencyKey);
        return !!existing;
      },
      catch: (error) =>
        new IdempotencyCheckError({
          idempotencyKey,
          message: `Failed to check idempotency: ${error}`,
        }),
    });
  }
}
```

### 7. NestJS Module Configuration

```typescript
// src/contexts/trading/trading.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ImportTransactionHandler } from './application/commands/import-transaction.handler';
import { RecordEntriesHandler } from './application/commands/record-entries.handler';
import { ClassifyTransactionHandler } from './application/commands/classify-transaction.handler';
import { TransactionRepository } from './infrastructure/repositories/transaction.repository';
import { TransactionController } from './api/transaction.controller';
import { EventStoreModule } from '../../infrastructure/event-store/event-store.module';
import { DomainErrorFilter } from './api/filters/domain-error.filter';
import { APP_FILTER } from '@nestjs/core';
import { Layer } from 'effect';
import {
  TransactionClassifier,
  RuleBasedTransactionClassifierLayer,
} from './domain/services/transaction-classifier.service';

// Command handlers
const CommandHandlers = [
  ImportTransactionHandler,
  RecordEntriesHandler,
  ClassifyTransactionHandler,
];

// Event handlers
const EventHandlers = [];

// Query handlers
const QueryHandlers = [];

@Module({
  imports: [CqrsModule, EventStoreModule],
  controllers: [TransactionController],
  providers: [
    TransactionRepository,
    ...CommandHandlers,
    ...EventHandlers,
    ...QueryHandlers,
    {
      provide: TransactionClassifier,
      useFactory: () => {
        // Provide the concrete implementation
        return new RuleBasedTransactionClassifier([
          // Add classification rules here
        ]);
      },
    },
    {
      provide: APP_FILTER,
      useClass: DomainErrorFilter,
    },
  ],
  exports: [TransactionRepository],
})
export class TradingModule {}
```

### 8. Domain Error Exception Filter

```typescript
// src/contexts/trading/api/filters/domain-error.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  ConflictException,
} from '@nestjs/common';
import { Response } from 'express';

// Domain errors from various layers
import {
  InvalidMoneyAmountError,
  CurrencyMismatchError,
} from '../../../../@core/domain/common-types/money.vo';
import {
  UnbalancedEntriesError,
  InvalidAccountCombinationError,
} from '../../domain/services/ledger-rules.service';
import {
  InvalidStateError,
  AlreadyReversedError,
} from '../../domain/aggregates/transaction.aggregate';
import {
  LoadTransactionError,
  SaveTransactionError,
  IdempotencyCheckError,
} from '../../infrastructure/repositories/transaction.repository';
import { PublishEventError } from '../../application/commands/record-entries.handler';

@Catch(Data.TaggedError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Map specific domain errors to appropriate HTTP status codes
    const errorMapping = this.mapDomainErrorToHttpResponse(exception);

    response.status(errorMapping.status).json({
      statusCode: errorMapping.status,
      error: errorMapping.error,
      message: errorMapping.message,
      timestamp: new Date().toISOString(),
    });
  }

  private mapDomainErrorToHttpResponse(exception: any): {
    status: HttpStatus;
    error: string;
    message: string;
  } {
    // Value Object validation errors -> 400 Bad Request
    if (exception instanceof InvalidMoneyAmountError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'Invalid Money Amount',
        message: `Invalid amount: ${exception.amount}`,
      };
    }

    if (exception instanceof CurrencyMismatchError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'Currency Mismatch',
        message: `Cannot perform operation with different currencies: ${exception.left.symbol} and ${exception.right.symbol}`,
      };
    }

    // Business rule validation errors -> 400 Bad Request
    if (exception instanceof UnbalancedEntriesError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'Unbalanced Entries',
        message: `Entries do not balance for currency ${exception.currency}. Difference: ${exception.difference.amount.toString()}`,
      };
    }

    if (exception instanceof InvalidAccountCombinationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'Invalid Account Combination',
        message: `Account type ${exception.accountType} cannot hold asset type ${exception.assetType}`,
      };
    }

    // Aggregate state errors -> 400 Bad Request or 409 Conflict
    if (exception instanceof InvalidStateError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'Invalid State',
        message: exception.message,
      };
    }

    if (exception instanceof AlreadyReversedError) {
      return {
        status: HttpStatus.CONFLICT,
        error: 'Already Reversed',
        message: `Transaction ${exception.transactionId} has already been reversed`,
      };
    }

    // Repository errors -> 404 Not Found or 500 Internal Server Error
    if (exception instanceof LoadTransactionError) {
      return {
        status: HttpStatus.NOT_FOUND,
        error: 'Transaction Not Found',
        message: `Transaction ${exception.transactionId} not found`,
      };
    }

    if (exception instanceof SaveTransactionError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Save Failed',
        message: 'Failed to save transaction. Please try again.',
      };
    }

    if (exception instanceof IdempotencyCheckError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Idempotency Check Failed',
        message: 'Unable to verify request uniqueness. Please try again.',
      };
    }

    // Event publishing errors -> 500 Internal Server Error (but transaction was saved)
    if (exception instanceof PublishEventError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Event Publishing Failed',
        message:
          'Operation completed but event notification failed. Support has been notified.',
      };
    }

    // Fallback for unexpected errors
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred. Please contact support.',
    };
  }
}
```

### 9. API Controller

```typescript
// src/contexts/trading/api/transaction.controller.ts
import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ImportTransactionDto, RecordEntriesDto } from './dto';
import {
  ImportTransactionCommand,
  RecordEntriesCommand,
} from '../domain/aggregates/transaction.aggregate';
import {
  UserId,
  TransactionId,
} from '../../../@core/domain/common-types/identifiers';
import { ExternalId } from '../domain/value-objects/identifiers.vo';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('import')
  @ApiOperation({ summary: 'Import a transaction from external source' })
  async importTransaction(@Body() dto: ImportTransactionDto) {
    const command: ImportTransactionCommand = {
      userId: UserId(dto.userId),
      externalId: ExternalId(dto.externalId),
      source: dto.source,
      rawData: dto.rawData,
    };

    await this.commandBus.execute(command);

    return { success: true };
  }

  @Post(':id/entries')
  @ApiOperation({ summary: 'Record ledger entries for a transaction' })
  async recordEntries(
    @Param('id') transactionId: string,
    @Body() dto: RecordEntriesDto,
  ) {
    // Pass raw DTO to command - parsing happens in the handler
    const command: RecordEntriesCommand = {
      transactionId: TransactionId(transactionId),
      entries: dto.entries, // Keep as raw DTO data
    };

    await this.commandBus.execute(command);

    return { success: true };
  }
}
```
