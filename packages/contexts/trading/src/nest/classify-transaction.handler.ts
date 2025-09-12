import { UnifiedEventBusTag } from '@exitbook/platform-event-bus';
import type { UnifiedEventBus } from '@exitbook/platform-event-bus';
import { Injectable } from '@nestjs/common';
import { CommandHandler, type ICommandHandler, type EventBus as NestEventBus } from '@nestjs/cqrs';
import { Effect, Exit, Layer, Stream } from 'effect';

import {
  classifyTransaction,
  TransactionRepositoryTag,
  TransactionClassifierTag,
} from '../app/commands/classify-transaction.handler';
import type { TransactionClassifier } from '../core';
import type { ClassifyTransactionCommand } from '../core';
import type { TransactionRepository } from '../ports';

// NestJS adapter for UnifiedEventBus
const createUnifiedEventBusLayer = (nestEventBus: NestEventBus): Layer.Layer<UnifiedEventBus> =>
  Layer.succeed(UnifiedEventBusTag, {
    append: () => Effect.succeed({ appended: [], lastPosition: 0n, lastVersion: 0 }),
    publishExternal: (topic: string, event: unknown) =>
      Effect.tryPromise({
        catch: (error) => error,
        try: () => nestEventBus.publish(event as object) as Promise<void>,
      }),
    read: () => Stream.empty,
    subscribeAll: () => Stream.empty,
    subscribeCategory: () => Stream.empty,
    subscribeLive: () => Stream.empty,
    subscribeStream: () => Stream.empty,
  } satisfies UnifiedEventBus);

@Injectable()
@CommandHandler('ClassifyTransactionCommand')
export class ClassifyTransactionHandler implements ICommandHandler<ClassifyTransactionCommand> {
  constructor(
    private readonly repository: TransactionRepository,
    private readonly eventBus: NestEventBus,
    private readonly classifier: TransactionClassifier,
  ) {}

  async execute(command: ClassifyTransactionCommand): Promise<void> {
    // Create runtime layer with NestJS-injected dependencies
    const runtimeLayer = Layer.mergeAll(
      Layer.succeed(TransactionRepositoryTag, this.repository),
      Layer.succeed(TransactionClassifierTag, this.classifier),
      createUnifiedEventBusLayer(this.eventBus),
    );

    // Run the pure Effect program with the runtime layer
    const program = Effect.provide(classifyTransaction(command), runtimeLayer);

    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      // Extract the typed error and re-throw for NestJS exception filters
      const error = exit.cause._tag === 'Fail' ? exit.cause.error : new Error('Unknown error');
      throw error;
    }
  }
}
