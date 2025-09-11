import { Effect, Context, Layer } from 'effect';

// Metrics interface for outbox observability
export interface OutboxMetrics {
  readonly incrementClaimed: (count: number) => Effect.Effect<void, never, never>;
  readonly incrementFailed: (count: number) => Effect.Effect<void, never, never>;
  readonly incrementPublished: (count: number) => Effect.Effect<void, never, never>;
  readonly incrementRetries: (count: number) => Effect.Effect<void, never, never>;
  readonly logError: (eventId: string, error: string) => Effect.Effect<void, never, never>;
  readonly recordPublishLatency: (latencyMs: number) => Effect.Effect<void, never, never>;
  readonly setBacklogGauge: (count: number) => Effect.Effect<void, never, never>;
}

export const OutboxMetrics = Context.GenericTag<OutboxMetrics>('@platform/OutboxMetrics');

// No-op implementation for when metrics aren't needed
export const makeNoOpMetrics = (): OutboxMetrics => ({
  incrementClaimed: () => Effect.void,
  incrementFailed: () => Effect.void,
  incrementPublished: () => Effect.void,
  incrementRetries: () => Effect.void,
  logError: (eventId, error) =>
    Effect.logWarning(`Outbox processing failed for event ${eventId}: ${error.substring(0, 200)}`),
  recordPublishLatency: () => Effect.void,
  setBacklogGauge: () => Effect.void,
});

// Default layer with no-op metrics (can be replaced with real metrics later)
export const OutboxMetricsNoOp = Layer.succeed(OutboxMetrics, makeNoOpMetrics());

// Console-based implementation for development/debugging
export const makeConsoleMetrics = (): OutboxMetrics => ({
  incrementClaimed: (count) => Effect.logDebug(`Outbox: claimed ${count} events`),
  incrementFailed: (count) => Effect.logWarning(`Outbox: failed ${count} events`),
  incrementPublished: (count) => Effect.logDebug(`Outbox: published ${count} events`),
  incrementRetries: (count) => Effect.logDebug(`Outbox: scheduled ${count} retries`),
  logError: (eventId, error) =>
    Effect.logError(`Outbox processing failed for event ${eventId}: ${error.substring(0, 500)}`),
  recordPublishLatency: (latencyMs) => Effect.logDebug(`Outbox: publish latency ${latencyMs}ms`),
  setBacklogGauge: (count) => Effect.logDebug(`Outbox: backlog size ${count}`),
});

export const OutboxMetricsConsole = Layer.succeed(OutboxMetrics, makeConsoleMetrics());
