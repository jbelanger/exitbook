import { TransactionId } from '@exitbook/core';
import { UnifiedEventBusTag } from '@exitbook/platform-event-bus';
import type { UnifiedEventBus } from '@exitbook/platform-event-bus';
import { Layer, Effect, Stream } from 'effect';

import { TransactionClassification } from '../core/aggregates/transaction.aggregate.js';
import {
  TransactionClassifierTag,
  type TransactionClassifier,
  type RawTransactionData,
} from '../ports/transaction-classifier.port.js';
import { TransactionRepositoryTag } from '../ports/transaction-repository.port.js';
import type { TransactionRepository } from '../ports/transaction-repository.port.js';
import { LoadTransactionError } from '../ports/transaction-repository.port.js';

// Test/in-memory implementations for testing
const TransactionRepositoryTest: TransactionRepository = {
  checkIdempotency: () => Effect.succeed(true),
  load: () =>
    Effect.fail(
      new LoadTransactionError({
        message: 'Not implemented',
        transactionId: TransactionId.of('test'),
      }),
    ),
  save: () => Effect.succeed(void 0),
};

const TransactionClassifierTest: TransactionClassifier = {
  classify: (_rawData: RawTransactionData) =>
    Effect.succeed(new TransactionClassification(0.5, 'TEST')),
};

const EventBusTest: UnifiedEventBus = {
  append: () => Effect.succeed({ appended: [], lastPosition: 0n, lastVersion: 0 }),
  publishExternal: () => Effect.succeed(void 0),
  read: () => Stream.empty,
  subscribeAll: () => Stream.empty,
  subscribeCategory: () => Stream.empty,
  subscribeLive: () => Stream.empty,
  subscribeStream: () => Stream.empty,
};

// Test runtime layer composition with in-memory/fake implementations
export const TradingRuntimeTest = Layer.mergeAll(
  Layer.succeed(TransactionRepositoryTag, TransactionRepositoryTest),
  Layer.succeed(TransactionClassifierTag, TransactionClassifierTest),
  Layer.succeed(UnifiedEventBusTag, EventBusTest),
);
