import { Effect, Schedule, Console } from 'effect';

import { OutboxProcessor } from './outbox-processor';

// Configuration for the outbox daemon
export interface OutboxDaemonConfig {
  readonly batchSize: number;
  readonly intervalMs: number;
  readonly maxAttempts: number;
}

// Default configuration
export const defaultConfig: OutboxDaemonConfig = {
  batchSize: 100,
  intervalMs: 1000, // 1 second
  maxAttempts: 10,
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

    // Run the processing loop with the configured interval
    const schedule = Schedule.fixed(config.intervalMs);

    yield* Console.info(
      `Starting outbox daemon with batch size ${config.batchSize}, interval ${config.intervalMs}ms`,
    );

    return yield* Effect.repeat(processOnce, schedule);
  });
