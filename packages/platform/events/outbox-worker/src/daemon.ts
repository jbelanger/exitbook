import { OutboxDatabaseTag, type OutboxDatabase } from '@exitbook/platform-event-store/port';
import { Effect, Duration, Context, Layer, pipe, Fiber, Schedule } from 'effect';

import { OutboxMetricsTag, type OutboxMetrics } from './metrics';
import { defaultOutboxConfig } from './processor';
import { OutboxProcessorTag, type OutboxConfig, type OutboxProcessor } from './processor';

/**
 * Outbox daemon that continuously processes pending events
 */
export interface OutboxDaemon {
  readonly start: () => Effect.Effect<void, never, unknown>;
  readonly stop: () => Effect.Effect<void, never, never>;
}

export const OutboxDaemonTag = Context.GenericTag<OutboxDaemon>(
  '@exitbook/outbox-worker/OutboxDaemon',
);

export interface DaemonConfig extends OutboxConfig {
  readonly batchSize: number;
  readonly intervalMs: number;
  readonly maxIdleRounds: number;
}

export const defaultDaemonConfig: DaemonConfig = {
  ...defaultOutboxConfig,
  batchSize: 100,
  intervalMs: 1000, // 1 second
  maxIdleRounds: 10, // Stop after 10 consecutive empty rounds
};

export const makeOutboxDaemon = (
  config: DaemonConfig = defaultDaemonConfig,
): Effect.Effect<OutboxDaemon, never, OutboxProcessor | OutboxMetrics | OutboxDatabase> =>
  Effect.gen(function* () {
    const processor = yield* OutboxProcessorTag;
    const metrics = yield* OutboxMetricsTag;
    const db = yield* OutboxDatabaseTag;

    // Update gauges with current queue metrics
    const updateGauges = Effect.gen(function* () {
      const queueDepth = yield* db.getQueueDepth();
      const dlqSize = yield* db.getDLQSize();
      yield* metrics.setQueueDepth(queueDepth);
      yield* metrics.setDlqSize(dlqSize);
    }).pipe(
      Effect.catchAll((error) => {
        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === 'object' && error !== null && 'reason' in error
              ? String((error as { reason: unknown }).reason)
              : String(error);
        return Effect.logWarning(`Failed to update queue metrics: ${errorMessage}`);
      }),
    );

    // Create a schedule that polls every intervalMs, with slower backoff after maxIdleRounds empty rounds
    const pollSchedule = Schedule.addDelay(Schedule.count, (n) => {
      // After maxIdleRounds consecutive empty polls, increase the delay
      const isBackoff = n >= config.maxIdleRounds;
      const delayMs = isBackoff
        ? Math.min(config.intervalMs * 5, 30000) // Max 30s backoff
        : config.intervalMs;
      return Duration.millis(delayMs);
    });

    const processWithLogging = processor.processPendingEvents(config.batchSize).pipe(
      Effect.tap((processedCount) => {
        if (processedCount === 0) {
          return Effect.logDebug(`Outbox daemon processed 0 events`);
        } else {
          return Effect.logInfo(`Outbox daemon processed ${processedCount} events`);
        }
      }),
      Effect.tap(() => updateGauges), // Update gauges after each processing round
      Effect.map((count) => count > 0), // Return true if we processed events, false if idle
    );

    const loop = Effect.forever(
      Effect.retry(processWithLogging, pollSchedule).pipe(
        Effect.catchAll((error) => {
          const errorMessage =
            error instanceof Error
              ? error.message
              : typeof error === 'object' && error !== null && 'reason' in error
                ? String((error as { reason: unknown }).reason)
                : String(error);
          return pipe(
            Effect.logError(`Outbox daemon error: ${errorMessage}`),
            Effect.flatMap(() => Effect.sleep(Duration.millis(config.intervalMs * 2))), // Back off on error
            Effect.map(() => false), // Treat errors as idle rounds
          );
        }),
      ),
    );

    let fiber: Fiber.RuntimeFiber<never, never> | null = null;

    return {
      start: () =>
        pipe(
          Effect.logInfo('Starting outbox daemon...'),
          Effect.flatMap(() => Effect.fork(loop)),
          Effect.flatMap((f) =>
            Effect.sync(() => {
              fiber = f;
            }),
          ),
        ),

      stop: () =>
        fiber
          ? pipe(
              Effect.logInfo('Stopping outbox daemon...'),
              Effect.flatMap(() => Fiber.interrupt(fiber!)),
            )
          : Effect.void,
    };
  });

// Layer factory for OutboxDaemon
export const OutboxDaemonLive = (config?: DaemonConfig) =>
  Layer.effect(OutboxDaemonTag, makeOutboxDaemon(config));
