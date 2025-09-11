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
  readonly attempts: number;
  readonly category: string;
  readonly created_at: Date;
  readonly event_id: string;
  readonly event_type: string;
  readonly id: number;
  readonly metadata: EventMetadata;
  readonly next_attempt_at: Date;
  readonly payload: unknown;
  readonly processed_at?: Date;
  readonly status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';
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
  readonly claimPendingEvents: (
    batchSize: number,
  ) => Effect.Effect<OutboxEntry[], OutboxReadError, never>;

  readonly markAsDLQ: (eventId: string) => Effect.Effect<void, OutboxProcessError, never>;

  readonly selectPendingEvents: (
    batchSize: number,
  ) => Effect.Effect<OutboxEntry[], OutboxReadError, never>;

  readonly transaction: <A, E>(
    effect: Effect.Effect<A, E, never>,
  ) => Effect.Effect<A, E | OutboxProcessError, never>;

  readonly updateEventForRetry: (
    eventId: string,
    attempts: number,
    nextAttemptAt: Date,
  ) => Effect.Effect<void, OutboxProcessError, never>;

  readonly updateEventStatus: (
    eventId: string,
    status: 'PROCESSED' | 'FAILED' | 'PROCESSING',
    processedAt?: Date,
  ) => Effect.Effect<void, OutboxProcessError, never>;
}

export const OutboxDatabase = Context.GenericTag<OutboxDatabase>('@platform/OutboxDatabase');

// MessagePublisher interface for outbox processor
export interface MessagePublisher {
  readonly publish: (
    topic: string,
    key: string,
    message: unknown,
    options?: {
      causationId?: string;
      correlationId?: string;
      userId?: string;
    },
  ) => Effect.Effect<void, OutboxProcessError, never>;
}

export const MessagePublisher = Context.GenericTag<MessagePublisher>('@platform/MessagePublisher');

// Configuration for retry behavior
export interface OutboxConfig {
  readonly baseDelayMs: number;
  readonly jitterMs: number;
  readonly maxAttempts: number;
  readonly maxDelayMs: number;
}

export const defaultOutboxConfig: OutboxConfig = {
  baseDelayMs: 1000, // 1 second
  jitterMs: 250,
  maxAttempts: 7,
  maxDelayMs: 300000, // 5 minutes
};

// Calculate next attempt time with exponential backoff + jitter
const calculateNextAttemptAt = (attempts: number, config: OutboxConfig): Date => {
  const exponentialDelay = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * Math.pow(2, Math.min(attempts, 7)),
  );
  const jitter = Math.floor(Math.random() * config.jitterMs);
  const totalDelayMs = exponentialDelay + jitter;

  return new Date(Date.now() + totalDelayMs);
};

// Pure outbox processor implementation
export const makeOutboxProcessor = (
  db: OutboxDatabase,
  publisher: MessagePublisher,
  config: OutboxConfig = defaultOutboxConfig,
): OutboxProcessor => ({
  getPendingEvents: (batchSize = 100) => db.selectPendingEvents(batchSize),

  markAsFailed: (eventId: string) => db.updateEventStatus(eventId, 'FAILED'),

  markAsProcessed: (eventId: string) => db.updateEventStatus(eventId, 'PROCESSED', new Date()),

  processPendingEvents: (batchSize = 100) =>
    pipe(
      db.claimPendingEvents(batchSize),
      Effect.mapError((error) => new OutboxProcessError({ reason: error.reason })),
      Effect.flatMap((entries) =>
        pipe(
          entries,
          Effect.forEach(
            (entry) => {
              // Generate topic and key according to convention: domain.<category>.<type>.v1
              const topic = `domain.${entry.category}.${entry.event_type}.v1`;
              const key = entry.id.toString(); // Use outbox entry ID as key for ordering

              return pipe(
                publisher.publish(topic, key, entry.payload, {
                  ...(entry.metadata.causationId && {
                    causationId: entry.metadata.causationId,
                  }),
                  ...(entry.metadata.correlationId && {
                    correlationId: entry.metadata.correlationId,
                  }),
                  ...(entry.metadata.userId && { userId: entry.metadata.userId }),
                }),
                Effect.flatMap(() => db.updateEventStatus(entry.event_id, 'PROCESSED', new Date())),
                Effect.catchAll((_publishError) => {
                  // Check if we should retry or send to DLQ
                  if (entry.attempts >= config.maxAttempts) {
                    // Send to DLQ (mark as FAILED)
                    return db.markAsDLQ(entry.event_id);
                  } else {
                    // Schedule retry with exponential backoff
                    const nextAttemptAt = calculateNextAttemptAt(entry.attempts, config);
                    return db.updateEventForRetry(entry.event_id, entry.attempts, nextAttemptAt);
                  }
                }),
              );
            },
            { concurrency: 'unbounded' },
          ),
          Effect.map((results) => results.length),
        ),
      ),
    ),
});

// Layer factory for OutboxProcessor
export const OutboxProcessorLive = Layer.effect(
  OutboxProcessor,
  Effect.all([OutboxDatabase, MessagePublisher]).pipe(
    Effect.map(([db, publisher]) => makeOutboxProcessor(db, publisher, defaultOutboxConfig)),
  ),
);

// Layer factory with custom config
export const makeOutboxProcessorLive = (config: OutboxConfig) =>
  Layer.effect(
    OutboxProcessor,
    Effect.all([OutboxDatabase, MessagePublisher]).pipe(
      Effect.map(([db, publisher]) => makeOutboxProcessor(db, publisher, config)),
    ),
  );
