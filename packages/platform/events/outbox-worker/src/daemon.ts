import { Effect, Console } from 'effect';

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

    yield* Console.info(
      `Starting outbox daemon with batch size ${config.batchSize}, interval ${config.intervalMs}ms`,
    );

    // Implement drain-fast scheduling: loop immediately while processing events,
    // sleep with jitter when idle to reduce unnecessary database polling
    return yield* Effect.gen(function* () {
      while (true) {
        const processedCount = yield* processOnce;

        if (processedCount === 0) {
          // No events processed - sleep with jitter to avoid thundering herd
          const jitter = Math.floor(Math.random() * (config.intervalMs * 0.2));
          const sleepTime = config.intervalMs + jitter;
          yield* Effect.sleep(sleepTime);
        }
        // If events were processed, loop immediately to drain the backlog
      }
    });
  });
