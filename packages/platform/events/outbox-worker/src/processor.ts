import { OutboxDatabaseTag } from '@exitbook/platform-event-store/port';
import type { OutboxDatabase, OutboxEntry } from '@exitbook/platform-event-store/port';
import { MessageBusProducerTag, topic } from '@exitbook/platform-messaging';
import type { MessageBusProducer } from '@exitbook/platform-messaging';
import { Effect, Data, Context, Layer, pipe } from 'effect';

import { OutboxMetricsTag, type OutboxMetrics } from './metrics';
import { createStatusTransitions } from './status-transitions';

// Outbox specific errors
export class OutboxProcessError extends Data.TaggedError('OutboxProcessError')<{
  readonly reason: string;
}> {}

export class OutboxReadError extends Data.TaggedError('OutboxReadError')<{
  readonly reason: string;
}> {}

// Outbox processor interface
export interface OutboxProcessor {
  readonly getPendingEvents: (
    batchSize?: number,
  ) => Effect.Effect<readonly OutboxEntry[], OutboxReadError, never>;

  readonly markAsFailed: (eventId: string) => Effect.Effect<void, OutboxProcessError, never>;

  readonly markAsProcessed: (eventId: string) => Effect.Effect<void, OutboxProcessError, never>;

  readonly processPendingEvents: (
    batchSize?: number,
  ) => Effect.Effect<number, OutboxProcessError, never>;
}

export const OutboxProcessorTag = Context.GenericTag<OutboxProcessor>(
  '@exitbook/outbox-worker/OutboxProcessor',
);

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
  const totalDelay = exponentialDelay + jitter;

  return new Date(Date.now() + totalDelay);
};

// Outbox processor implementation
export const makeOutboxProcessor = (
  config: OutboxConfig = defaultOutboxConfig,
): Effect.Effect<OutboxProcessor, never, OutboxDatabase | MessageBusProducer | OutboxMetrics> =>
  Effect.gen(function* () {
    const db = yield* OutboxDatabaseTag;
    const publisher = yield* MessageBusProducerTag;
    const metrics = yield* OutboxMetricsTag;
    const statusTransitions = createStatusTransitions(db);

    const processEntries = (entries: readonly OutboxEntry[]) =>
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

            // Extract metadata for CloudEvent options
            const metadata = (entry.metadata as Record<string, unknown>) || {};
            const publishOptions: {
              causationId?: string;
              correlationId?: string;
              key: string;
              userId?: string;
            } = { key };

            if (metadata['causationId'] && typeof metadata['causationId'] === 'string') {
              publishOptions.causationId = metadata['causationId'];
            }
            if (metadata['correlationId'] && typeof metadata['correlationId'] === 'string') {
              publishOptions.correlationId = metadata['correlationId'];
            }
            if (metadata['userId'] && typeof metadata['userId'] === 'string') {
              publishOptions.userId = metadata['userId'];
            }

            const startTime = Date.now();
            return pipe(
              publisher.publish(topicName, entry.event_data, publishOptions),
              Effect.tap(() => {
                const latency = Date.now() - startTime;
                return pipe(
                  metrics.recordPublishLatency(latency),
                  Effect.flatMap(() => metrics.incrementPublished(1)),
                );
              }),
              Effect.flatMap(() => statusTransitions.markProcessed(entry.event_id)),
              Effect.catchAll((publishError) => {
                const errorMessage =
                  publishError instanceof Error
                    ? publishError.message
                    : typeof publishError === 'object' &&
                        publishError !== null &&
                        'reason' in publishError
                      ? String((publishError as { reason: unknown }).reason)
                      : String(publishError);
                return pipe(
                  metrics.logError(entry.event_id, errorMessage),
                  Effect.flatMap(() =>
                    statusTransitions.resolveStatus(
                      entry.event_id,
                      entry.attempts,
                      config.maxAttempts,
                      errorMessage,
                      () => calculateNextAttemptAt(entry.attempts, config),
                    ),
                  ),
                  Effect.tap((resolution) => {
                    switch (resolution) {
                      case 'failed':
                        return metrics.incrementFailed(1);
                      case 'retry':
                        return metrics.incrementRetries(1);
                      case 'processed':
                        return Effect.void; // Already handled above
                    }
                  }),
                );
              }),
            );
          },
          { concurrency: config.publishConcurrency ?? 16 },
        ),
      );

    return {
      getPendingEvents: (batchSize = 100) =>
        db
          .selectPendingEvents(batchSize)
          .pipe(Effect.mapError((error) => new OutboxReadError({ reason: error.reason }))),

      markAsFailed: (eventId: string) =>
        statusTransitions
          .markFailed(eventId)
          .pipe(Effect.mapError((error) => new OutboxProcessError({ reason: error.reason }))),

      markAsProcessed: (eventId: string) =>
        statusTransitions
          .markProcessed(eventId)
          .pipe(Effect.mapError((error) => new OutboxProcessError({ reason: error.reason }))),

      processPendingEvents: (batchSize = 100) =>
        pipe(
          db.claimPendingEvents(batchSize),
          Effect.mapError((error) => new OutboxProcessError({ reason: error.reason })),
          Effect.tap((entries) => metrics.incrementClaimed(entries.length)),
          Effect.flatMap(processEntries),
          Effect.map((results) => results.length),
          Effect.catchAll((error) => {
            // Log the error and return 0 processed
            const errorMessage =
              error instanceof Error
                ? error.message
                : typeof error === 'object' && error !== null && 'reason' in error
                  ? String((error as { reason: unknown }).reason)
                  : String(error);
            return pipe(
              Effect.logError(`Outbox processing failed: ${errorMessage}`),
              Effect.map(() => 0),
            );
          }),
        ),
    } satisfies OutboxProcessor;
  });

// Layer factory for OutboxProcessor
export const OutboxProcessorLive = (config?: OutboxConfig) =>
  Layer.effect(OutboxProcessorTag, makeOutboxProcessor(config));
