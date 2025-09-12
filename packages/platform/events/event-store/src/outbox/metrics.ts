import { Effect, Layer } from 'effect';

import { OutboxMetrics } from './processor';

// Simple console-based metrics implementation
export const makeConsoleOutboxMetrics = (): OutboxMetrics => ({
  incrementClaimed: (count: number) =>
    Effect.sync(() => console.log(`[OutboxMetrics] Claimed ${count} events`)),

  incrementFailed: (count: number) =>
    Effect.sync(() => console.log(`[OutboxMetrics] Failed ${count} events`)),

  incrementPublished: (count: number) =>
    Effect.sync(() => console.log(`[OutboxMetrics] Published ${count} events`)),

  incrementRetries: (count: number) =>
    Effect.sync(() => console.log(`[OutboxMetrics] Retrying ${count} events`)),

  logError: (eventId: string, error: string) =>
    Effect.sync(() => console.error(`[OutboxMetrics] Error for event ${eventId}: ${error}`)),

  recordPublishLatency: (latencyMs: number) =>
    Effect.sync(() => console.log(`[OutboxMetrics] Publish latency: ${latencyMs}ms`)),
});

// Layer that provides console metrics
export const ConsoleOutboxMetricsLive = Layer.succeed(OutboxMetrics, makeConsoleOutboxMetrics());

// No-op metrics implementation for testing
export const makeNoOpOutboxMetrics = (): OutboxMetrics => ({
  incrementClaimed: () => Effect.void,
  incrementFailed: () => Effect.void,
  incrementPublished: () => Effect.void,
  incrementRetries: () => Effect.void,
  logError: () => Effect.void,
  recordPublishLatency: () => Effect.void,
});

// Layer that provides no-op metrics
export const NoOpOutboxMetricsLive = Layer.succeed(OutboxMetrics, makeNoOpOutboxMetrics());
