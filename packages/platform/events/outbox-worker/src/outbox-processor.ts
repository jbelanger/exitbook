import { MessageBusProducerTag, topic } from '@exitbook/platform-messaging';
import type { MessageBusProducer } from '@exitbook/platform-messaging';
import { Effect, Data, Context, Layer, pipe } from 'effect';

import { OutboxMetrics } from './observability';

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
  readonly cloudevent: string; // JSON-stringified CloudEvent
  readonly created_at: Date;
  readonly event_id: string;
  readonly event_position: bigint;
  readonly event_schema_version: number;
  readonly event_type: string;
  readonly id: number;
  readonly last_error?: string;
  readonly next_attempt_at: Date;
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
    nextAttemptAt: Date,
    lastError?: string,
  ) => Effect.Effect<void, OutboxProcessError, never>;

  readonly updateEventStatus: (
    eventId: string,
    status: 'PROCESSED' | 'FAILED' | 'PROCESSING',
    processedAt?: Date,
  ) => Effect.Effect<void, OutboxProcessError, never>;
}

export const OutboxDatabase = Context.GenericTag<OutboxDatabase>('@platform/OutboxDatabase');

// Configuration for retry behavior
export interface OutboxConfig {
  readonly baseDelayMs: number;
  readonly jitterMs: number;
  readonly maxAttempts: number;
  readonly maxDelayMs: number;
  readonly publishConcurrency?: number;
}

export const defaultOutboxConfig: OutboxConfig = {
  baseDelayMs: 1000, // 1 second
  jitterMs: 250,
  maxAttempts: 7,
  maxDelayMs: 300000, // 5 minutes
  publishConcurrency: 16,
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
  publisher: MessageBusProducer,
  metrics: OutboxMetrics,
  config: OutboxConfig = defaultOutboxConfig,
): OutboxProcessor => ({
  getPendingEvents: (batchSize = 100) => db.selectPendingEvents(batchSize),

  markAsFailed: (eventId: string) => db.updateEventStatus(eventId, 'FAILED'),

  markAsProcessed: (eventId: string) => db.updateEventStatus(eventId, 'PROCESSED', new Date()),

  processPendingEvents: (batchSize = 100) =>
    pipe(
      db.claimPendingEvents(batchSize),
      Effect.mapError((error) => new OutboxProcessError({ reason: error.reason })),
      Effect.tap((entries) => metrics.incrementClaimed(entries.length)),
      Effect.flatMap((entries) =>
        pipe(
          entries,
          Effect.forEach(
            (entry) => {
              // Generate topic using shared helper
              const topicName = topic(
                entry.category,
                entry.event_type,
                `v${entry.event_schema_version}`,
              );
              const key = String(entry.event_position); // Use event position for stable ordering

              const startTime = Date.now();
              return pipe(
                publisher.publish(topicName, entry.cloudevent, {
                  key,
                }),
                Effect.tap(() => {
                  const latency = Date.now() - startTime;
                  return pipe(
                    metrics.recordPublishLatency(latency),
                    Effect.flatMap(() => metrics.incrementPublished(1)),
                  );
                }),
                Effect.flatMap(() => db.updateEventStatus(entry.event_id, 'PROCESSED', new Date())),
                Effect.catchAll((publishError) => {
                  const errorMessage = publishError.reason;
                  return pipe(
                    metrics.logError(entry.event_id, errorMessage),
                    Effect.flatMap(() => {
                      // Check if we should retry or send to DLQ
                      if (entry.attempts >= config.maxAttempts) {
                        // Send to DLQ (mark as FAILED)
                        return pipe(
                          db.markAsDLQ(entry.event_id),
                          Effect.tap(() => metrics.incrementFailed(1)),
                        );
                      } else {
                        // Schedule retry with exponential backoff
                        const nextAttemptAt = calculateNextAttemptAt(entry.attempts, config);
                        return pipe(
                          db.updateEventForRetry(entry.event_id, nextAttemptAt, errorMessage),
                          Effect.tap(() => metrics.incrementRetries(1)),
                        );
                      }
                    }),
                  );
                }),
              );
            },
            { concurrency: config.publishConcurrency ?? 16 },
          ),
          Effect.map((results) => results.length),
        ),
      ),
    ),
});

// Layer factory for OutboxProcessor
export const OutboxProcessorLive = Layer.effect(
  OutboxProcessor,
  Effect.all([OutboxDatabase, MessageBusProducerTag, OutboxMetrics]).pipe(
    Effect.map(([db, publisher, metrics]) =>
      makeOutboxProcessor(db, publisher, metrics, defaultOutboxConfig),
    ),
  ),
);

// Layer factory with custom config
export const makeOutboxProcessorLive = (config: OutboxConfig) =>
  Layer.effect(
    OutboxProcessor,
    Effect.all([OutboxDatabase, MessageBusProducerTag, OutboxMetrics]).pipe(
      Effect.map(([db, publisher, metrics]) => makeOutboxProcessor(db, publisher, metrics, config)),
    ),
  );
