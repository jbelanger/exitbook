import { EventBus, EventBusError } from '@exitbook/platform-messaging';
import { Injectable } from '@nestjs/common';
import { CommandHandler, type ICommandHandler, type EventBus as NestEventBus } from '@nestjs/cqrs';
import { Effect, Exit, Layer } from 'effect';

import {
  classifyTransaction,
  TransactionRepositoryTag,
  TransactionClassifierTag,
} from '../app/commands/classify-transaction.handler';
import type { TransactionClassifier } from '../core';
import type { ClassifyTransactionCommand } from '../core';
import type { TransactionRepository } from '../ports';

// NestJS adapter for platform EventBus
const createEventBusLayer = (nestEventBus: NestEventBus) =>
  Layer.succeed(EventBus, {
    publish: (event: unknown) =>
      Effect.tryPromise({
        catch: (error) =>
          new EventBusError({
            eventType:
              typeof event === 'object' && event !== null && '_tag' in event
                ? String(event._tag)
                : 'unknown',
            message: `Failed to publish event: ${String(error)}`,
          }),
        try: () => nestEventBus.publish(event as object) as Promise<unknown>,
      }),
  });

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
      createEventBusLayer(this.eventBus),
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
