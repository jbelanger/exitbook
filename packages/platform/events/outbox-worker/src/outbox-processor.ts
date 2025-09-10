import { Effect, Data, Context, Layer, pipe } from 'effect';

import type { EventMetadata } from './model';

// Outbox specific errors
export class OutboxProcessError extends Data.TaggedError('OutboxProcessError')<{
  readonly reason: string;
}> {}

export class OutboxReadError extends Data.TaggedError('OutboxReadError')<{
  readonly reason: string;
}> {}

// Outbox entry schema - aligned with EventStore's outbox shape
export interface OutboxEntry {
  readonly category: string;
  readonly created_at: Date;
  readonly event_id: string;
  readonly event_type: string;
  readonly id: number;
  readonly metadata: EventMetadata;
  readonly payload: unknown;
  readonly processed_at?: Date;
  readonly status: 'PENDING' | 'PROCESSED' | 'FAILED';
  readonly stream_name: string;
}

// Outbox processor interface
export interface OutboxProcessor {
  readonly getPendingEvents: (
    batchSize?: number,
  ) => Effect.Effect<OutboxEntry[], OutboxReadError, never>;

  readonly markAsFailed: (eventId: string) => Effect.Effect<void, OutboxProcessError, never>;

  readonly markAsProcessed: (eventId: string) => Effect.Effect<void, OutboxProcessError, never>;

  readonly processPendingEvents: (
    batchSize?: number,
  ) => Effect.Effect<number, OutboxProcessError, never>;
}

export const OutboxProcessor = Context.GenericTag<OutboxProcessor>('@platform/OutboxProcessor');

// Database interface for outbox operations
export interface OutboxDatabase {
  readonly selectPendingEvents: (
    batchSize: number,
  ) => Effect.Effect<OutboxEntry[], OutboxReadError, never>;

  readonly transaction: <A, E>(
    effect: Effect.Effect<A, E, never>,
  ) => Effect.Effect<A, E | OutboxProcessError, never>;

  readonly updateEventStatus: (
    eventId: string,
    status: 'PROCESSED' | 'FAILED',
    processedAt?: Date,
  ) => Effect.Effect<void, OutboxProcessError, never>;
}

export const OutboxDatabase = Context.GenericTag<OutboxDatabase>('@platform/OutboxDatabase');

// MessagePublisher interface for outbox processor
export interface MessagePublisher {
  readonly publish: (
    exchange: string,
    routingKey: string,
    message: unknown,
    options?: {
      causationId?: string;
      correlationId?: string;
      userId?: string;
    },
  ) => Effect.Effect<void, OutboxProcessError, never>;
}

export const MessagePublisher = Context.GenericTag<MessagePublisher>('@platform/MessagePublisher');

// Pure outbox processor implementation
export const makeOutboxProcessor = (
  db: OutboxDatabase,
  publisher: MessagePublisher,
): OutboxProcessor => ({
  getPendingEvents: (batchSize = 100) => db.selectPendingEvents(batchSize),

  markAsFailed: (eventId: string) => db.updateEventStatus(eventId, 'FAILED'),

  markAsProcessed: (eventId: string) => db.updateEventStatus(eventId, 'PROCESSED', new Date()),

  processPendingEvents: (batchSize = 100) =>
    db.transaction(
      pipe(
        db
          .selectPendingEvents(batchSize)
          .pipe(Effect.mapError((error) => new OutboxProcessError({ reason: error.reason }))),
        Effect.flatMap((entries) =>
          pipe(
            entries,
            Effect.forEach((entry) =>
              pipe(
                publisher.publish('domain.events', entry.event_type, entry.payload, {
                  ...(entry.metadata.causationId && {
                    causationId: entry.metadata.causationId,
                  }),
                  ...(entry.metadata.correlationId && {
                    correlationId: entry.metadata.correlationId,
                  }),
                  ...(entry.metadata.userId && { userId: entry.metadata.userId }),
                }),
                Effect.flatMap(() => db.updateEventStatus(entry.event_id, 'PROCESSED', new Date())),
                Effect.catchAll(() => db.updateEventStatus(entry.event_id, 'FAILED')),
              ),
            ),
            Effect.map((results) => results.length),
          ),
        ),
      ),
    ),
});

// Layer factory for OutboxProcessor
export const OutboxProcessorLive = Layer.effect(
  OutboxProcessor,
  Effect.all([OutboxDatabase, MessagePublisher]).pipe(
    Effect.map(([db, publisher]) => makeOutboxProcessor(db, publisher)),
  ),
);
