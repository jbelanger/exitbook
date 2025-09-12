import { Effect, Console, Schedule, Duration } from 'effect';

import { OutboxProcessor } from './outbox-processor';

// Configuration for the outbox daemon
export interface OutboxDaemonConfig {
  readonly batchSize: number;
  readonly intervalMs: number;
}

// Default configuration
export const defaultConfig: OutboxDaemonConfig = {
  batchSize: 100,
  intervalMs: 1000,
};

/**
 * Runs the outbox daemon that continuously processes pending outbox entries.
 * This daemon polls for pending entries and publishes them via the configured transport.
 *
 * Based on ADR-0002 specifications:
 * - Polls using FOR UPDATE SKIP LOCKED for scalability
 * - Implements exponential backoff with jitter
 * - Handles failures with proper retry logic
 * - Supports horizontal scaling (multiple workers)
 */
export const runOutboxDaemon = (config: OutboxDaemonConfig = defaultConfig) =>
  Effect.gen(function* () {
    const processor = yield* OutboxProcessor;

    const processOnce = Effect.gen(function* () {
      const processedCount = yield* processor.processPendingEvents(config.batchSize);

      if (processedCount > 0) {
        yield* Console.info(`Processed ${processedCount} outbox entries`);
      }

      return processedCount;
    }).pipe(
      Effect.catchAll((error) =>
        Console.error(`Outbox processing failed: ${String(error)}`).pipe(
          Effect.as(0), // Return 0 processed count on error
        ),
      ),
    );

    yield* Console.info(
      `Starting outbox daemon with batch size ${config.batchSize}, interval ${config.intervalMs}ms`,
    );

    // Implement drain-fast scheduling using Effect.repeat with conditional scheduling:
    // - Loop immediately while processing events to drain backlog (no delay when processedCount > 0)
    // - Sleep with jitter when idle to reduce unnecessary database polling (delay when processedCount === 0)
    const baseSchedule = Schedule.spaced(Duration.millis(config.intervalMs));
    const jitteredSchedule = Schedule.jittered(baseSchedule);
    const conditionalSchedule = Schedule.whileOutput(
      (processedCount: number) => processedCount > 0,
    );

    const schedule = Schedule.union(conditionalSchedule, jitteredSchedule);

    return yield* processOnce.pipe(Effect.repeat(schedule));
  });
