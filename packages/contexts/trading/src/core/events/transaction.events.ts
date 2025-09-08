import type { TransactionId, UserId, Money } from '@exitbook/core';
import { DomainEvent } from '@exitbook/core';

import type { ExternalId, AccountId } from '../value-objects/identifiers.vo.js';

export class TransactionImported extends DomainEvent {
  readonly _tag = 'TransactionImported';

  constructor(
    readonly data: {
      readonly externalId: ExternalId;
      readonly idempotencyKey: string;
      readonly importedAt: Date;
      readonly rawData: unknown;
      readonly source: string;
      readonly transactionId: TransactionId;
      readonly userId: UserId;
    },
  ) {
    super({
      aggregateId: data.transactionId,
      timestamp: data.importedAt,
      version: 1,
    });
  }
}

export class TransactionClassified extends DomainEvent {
  readonly _tag = 'TransactionClassified';

  constructor(
    readonly data: {
      readonly classification: string;
      readonly classifiedAt: Date;
      readonly confidence: number;
      readonly protocol?: string;
      readonly transactionId: TransactionId;
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
      readonly entries: readonly {
        readonly accountId: AccountId;
        readonly amount: Money;
        readonly direction: 'DEBIT' | 'CREDIT';
        readonly entryType: string;
      }[];
      readonly recordedAt: Date;
      readonly transactionId: TransactionId;
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
      readonly reversalReason: string;
      readonly reversedAt: Date;
      readonly reversedBy: UserId;
      readonly transactionId: TransactionId;
    },
  ) {
    super({
      aggregateId: data.transactionId,
      timestamp: data.reversedAt,
      version: 1,
    });
  }
}
