import type { CurrencyMismatchError, DomainEvent, UserId } from '@exitbook/core';
import { EventSourcedAggregate, TransactionId } from '@exitbook/core';
import { Effect, pipe, Option, Data } from 'effect';

import {
  TransactionImported,
  TransactionClassified,
  LedgerEntriesRecorded,
  TransactionReversed,
} from '../events/transaction.events.js';
import type { UnbalancedEntriesError } from '../services/ledger-rules.service.js';
import { LedgerRules, type LedgerEntry } from '../services/ledger-rules.service.js';
import {
  TransactionClassifier,
  TransactionClassification,
} from '../services/transaction-classifier.service.js';
import type { ExternalId } from '../value-objects/identifiers.vo.js';
import { AccountId } from '../value-objects/identifiers.vo.js';

// Transaction errors
export class InvalidStateError extends Data.TaggedError('InvalidStateError')<{
  readonly message: string;
}> {}

export class AlreadyReversedError extends Data.TaggedError('AlreadyReversedError')<{
  readonly transactionId: TransactionId;
}> {}

// Transaction status enum
export enum TransactionStatus {
  CLASSIFIED = 'CLASSIFIED',
  IMPORTED = 'IMPORTED',
  RECORDED = 'RECORDED',
  REVERSED = 'REVERSED',
}

// Commands
export interface ImportTransactionCommand {
  readonly externalId: ExternalId;
  readonly rawData: unknown;
  readonly source: string;
  readonly userId: UserId;
}

export interface ClassifyTransactionCommand {
  readonly transactionId: TransactionId;
}

export interface RecordEntriesCommand {
  readonly entries: readonly {
    readonly accountId: string;
    readonly amount: string | number;
    readonly currency: string;
    readonly currencyName: string;
    readonly decimals: number;
    readonly direction: 'DEBIT' | 'CREDIT';
    readonly entryType: string;
  }[];
  readonly transactionId: TransactionId;
}

export interface ReverseTransactionCommand {
  readonly reason: string;
  readonly reversedBy: UserId;
  readonly transactionId: TransactionId;
}

// Transaction Aggregate
export class Transaction extends EventSourcedAggregate {
  // Create empty transaction for reconstruction
  static createEmpty(): Transaction {
    return new Transaction({
      classification: Option.none(),
      entries: [],
      events: [],
      externalId: Option.none(),
      status: TransactionStatus.IMPORTED,
      transactionId: Option.none(),
      userId: Option.none(),
      version: 0,
    });
  }

  // Factory method for importing - returns event, not new state
  static import(command: ImportTransactionCommand): Effect.Effect<TransactionImported, never> {
    return Effect.sync(() => {
      const transactionId = TransactionId.generate();
      return new TransactionImported({
        externalId: command.externalId,
        idempotencyKey: `${command.source}:${command.externalId}`,
        importedAt: new Date(),
        rawData: command.rawData,
        source: command.source,
        transactionId,
        userId: command.userId,
      });
    });
  }

  readonly transactionId: Option.Option<TransactionId>;
  readonly userId: Option.Option<UserId>;
  readonly externalId: Option.Option<ExternalId>;
  readonly status: TransactionStatus;
  readonly classification: Option.Option<TransactionClassification>;
  readonly entries: readonly LedgerEntry[];

  constructor(data: {
    readonly classification: Option.Option<TransactionClassification>;
    readonly entries: readonly LedgerEntry[];
    readonly events: readonly DomainEvent[];
    readonly externalId: Option.Option<ExternalId>;
    readonly status: TransactionStatus;
    readonly transactionId: Option.Option<TransactionId>;
    readonly userId: Option.Option<UserId>;
    readonly version: number;
  }) {
    super({ events: data.events, version: data.version });
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

  // The ONLY place where state transitions happen
  apply(event: DomainEvent): Transaction {
    switch (event._tag) {
      case 'TransactionImported': {
        const importedEvent = event as TransactionImported;
        return this.copy({
          events: [...this.events, event],
          externalId: Option.some(importedEvent.data.externalId),
          status: TransactionStatus.IMPORTED,
          transactionId: Option.some(importedEvent.data.transactionId),
          userId: Option.some(importedEvent.data.userId),
        });
      }

      case 'TransactionClassified': {
        const classifiedEvent = event as TransactionClassified;
        return this.copy({
          classification: Option.some(
            new TransactionClassification({
              confidence: classifiedEvent.data.confidence,
              type: classifiedEvent.data.classification,
              ...(classifiedEvent.data.protocol ? { protocol: classifiedEvent.data.protocol } : {}),
            }),
          ),
          events: [...this.events, event],
          status: TransactionStatus.CLASSIFIED,
        });
      }

      case 'LedgerEntriesRecorded': {
        const recordedEvent = event as LedgerEntriesRecorded;
        return this.copy({
          entries: recordedEvent.data.entries,
          events: [...this.events, event],
          status: TransactionStatus.RECORDED,
        });
      }

      case 'TransactionReversed':
        return this.copy({
          events: [...this.events, event],
          status: TransactionStatus.REVERSED,
        });

      default:
        return this;
    }
  }

  // Classify transaction - returns event only
  classify(): Effect.Effect<TransactionClassified, InvalidStateError, TransactionClassifier> {
    if (this.status !== TransactionStatus.IMPORTED) {
      return Effect.fail(
        new InvalidStateError({
          message: 'Transaction already classified',
        }),
      );
    }

    return pipe(
      Effect.succeed(this.transactionId),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new InvalidStateError({ message: 'Transaction ID is missing' })),
          onSome: (transactionId) => Effect.succeed(transactionId),
        }),
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
                classification: classification.type,
                confidence: classification.confidence,
                transactionId,
                ...(classification.protocol ? { protocol: classification.protocol } : {}),
                classifiedAt: new Date(),
              }),
          ),
        ),
      ),
    );
  }

  // Record ledger entries - returns event only
  recordEntries(
    entries: readonly LedgerEntry[],
  ): Effect.Effect<
    LedgerEntriesRecorded,
    InvalidStateError | UnbalancedEntriesError | CurrencyMismatchError
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
      Effect.succeed(this.transactionId),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new InvalidStateError({ message: 'Transaction ID is missing' })),
          onSome: (transactionId) => Effect.succeed(transactionId),
        }),
      ),
      Effect.flatMap((transactionId) =>
        pipe(
          LedgerRules.validateBalance(entries),
          Effect.map(
            () =>
              new LedgerEntriesRecorded({
                entries: entries.map((entry) => ({
                  accountId: AccountId.of(entry.accountId),
                  amount: entry.amount,
                  direction: entry.direction,
                  entryType: entry.entryType,
                })),
                recordedAt: new Date(),
                transactionId,
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
  ): Effect.Effect<TransactionReversed, AlreadyReversedError | InvalidStateError> {
    if (this.status === TransactionStatus.REVERSED) {
      return Effect.fail(
        new AlreadyReversedError({
          transactionId: Option.getOrUndefined(this.transactionId) || TransactionId.generate(),
        }),
      );
    }

    return pipe(
      Effect.succeed(this.transactionId),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new InvalidStateError({ message: 'Transaction ID is missing' })),
          onSome: (transactionId) => Effect.succeed(transactionId),
        }),
      ),
      Effect.map(
        (transactionId) =>
          new TransactionReversed({
            reversalReason: reason,
            reversedAt: new Date(),
            reversedBy,
            transactionId,
          }),
      ),
    );
  }

  protected override copy(updates: Partial<unknown>): this {
    const Constructor = this.constructor as new (data: unknown) => this;
    return new Constructor({ ...this, ...updates });
  }
}
