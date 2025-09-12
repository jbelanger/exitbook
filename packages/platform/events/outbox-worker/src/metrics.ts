import { Context, Effect, Layer } from 'effect';

// Simple metrics interface - can be implemented by different observability systems
export interface OutboxMetrics {
  incrementClaimed(count: number): Effect.Effect<void>;
  incrementFailed(count: number): Effect.Effect<void>;
  incrementPublished(count: number): Effect.Effect<void>;
  incrementRetries(count: number): Effect.Effect<void>;
  logError(eventId: string, error: string): Effect.Effect<void>;
  recordPublishLatency(latencyMs: number): Effect.Effect<void>;
}

export const OutboxMetricsTag = Context.GenericTag<OutboxMetrics>(
  '@exitbook/outbox-worker/OutboxMetrics',
);

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
export const ConsoleOutboxMetricsLive = Layer.succeed(OutboxMetricsTag, makeConsoleOutboxMetrics());

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
export const NoOpOutboxMetricsLive = Layer.succeed(OutboxMetricsTag, makeNoOpOutboxMetrics());
