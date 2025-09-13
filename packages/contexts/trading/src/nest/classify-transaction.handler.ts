import { Injectable } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { Effect, Exit } from 'effect';

import { classifyTransaction } from '../app/commands/classify-transaction.handler.js';
import type { ClassifyTransactionCommand } from '../app/commands/commands.js';
import { TradingRuntimeDefault } from '../compose/live.js';

@Injectable()
@CommandHandler('ClassifyTransactionCommand')
export class ClassifyTransactionHandler implements ICommandHandler<ClassifyTransactionCommand> {
  async execute(command: ClassifyTransactionCommand): Promise<void> {
    // Use the real durable event bus via TradingRuntimeDefault
    // Nest EventBus is kept only for the transport layer (commands/queries)
    const program = Effect.provide(classifyTransaction(command), TradingRuntimeDefault);

    const exit = await Effect.runPromiseExit(program);

    if (Exit.isFailure(exit)) {
      // Extract the typed error and re-throw for NestJS exception filters
      const error = exit.cause._tag === 'Fail' ? exit.cause.error : new Error('Unknown error');
      throw error;
    }
  }
}
