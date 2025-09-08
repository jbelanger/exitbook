import { TransactionId } from '@exitbook/core';
import { EventBus } from '@exitbook/platform-messaging';
import { Layer, Effect } from 'effect';

import {
  TransactionRepositoryTag,
  TransactionClassifierTag,
} from '../app/commands/classify-transaction.handler';
import type { TransactionClassifier, RawTransactionData } from '../core';
import { TransactionClassification } from '../core';
import type { TransactionRepository } from '../ports';
import { LoadTransactionError } from '../ports';

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
  save: () => Effect.succeed(),
};

const TransactionClassifierTest: TransactionClassifier = {
  classify: (_rawData: RawTransactionData) =>
    Effect.succeed(
      new TransactionClassification({
        confidence: 0.5,
        type: 'TEST',
      }),
    ),
};

const EventBusTest: EventBus = {
  publish: () => Effect.succeed(),
};

// Test runtime layer composition with in-memory/fake implementations
export const TradingRuntimeTest = Layer.mergeAll(
  Layer.succeed(TransactionRepositoryTag, TransactionRepositoryTest),
  Layer.succeed(TransactionClassifierTag, TransactionClassifierTest),
  Layer.succeed(EventBus, EventBusTest),
);
