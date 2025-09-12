import { Context, Effect, Layer, Metric, MetricBoundaries } from 'effect';

export interface OutboxMetrics {
  incrementClaimed(count: number): Effect.Effect<void>;
  incrementFailed(count: number): Effect.Effect<void>;
  incrementPublished(count: number): Effect.Effect<void>;
  incrementRetries(count: number): Effect.Effect<void>;
  logError(eventId: string, error: string): Effect.Effect<void>;
  recordPublishLatency(latencyMs: number): Effect.Effect<void>;
  setDlqSize(size: number): Effect.Effect<void>;
  setQueueDepth(depth: number): Effect.Effect<void>;
}

export const OutboxMetricsTag = Context.GenericTag<OutboxMetrics>(
  '@exitbook/outbox-worker/OutboxMetrics',
);

// OTEL metrics implementation
const publishLatency = Metric.histogram(
  'outbox.publish.duration',
  MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
);

const claimed = Metric.counter('outbox.messages.claimed', {
  description: 'Messages claimed from outbox',
});
const published = Metric.counter('outbox.messages.published', {
  description: 'Messages successfully published',
});
const failed = Metric.counter('outbox.messages.failed', {
  description: 'Messages failed to publish',
});
const retried = Metric.counter('outbox.messages.retried', {
  description: 'Messages scheduled for retry',
});
const queueDepth = Metric.gauge('outbox.queue.depth', {
  description: 'Current outbox queue depth',
});
const dlqSize = Metric.gauge('dlq.size', { description: 'Current DLQ size' });

export const makeOtelOutboxMetrics = (): OutboxMetrics => ({
  incrementClaimed: (count: number) => Metric.update(claimed, count),
  incrementFailed: (count: number) => Metric.update(failed, count),
  incrementPublished: (count: number) => Metric.update(published, count),
  incrementRetries: (count: number) => Metric.update(retried, count),
  logError: (eventId: string, error: string) =>
    Effect.logError(`Outbox error for ${eventId}: ${error}`),
  recordPublishLatency: (latencyMs: number) => Metric.update(publishLatency, latencyMs / 1000),
  setDlqSize: (size: number) => Metric.set(dlqSize, size),
  setQueueDepth: (depth: number) => Metric.set(queueDepth, depth),
});

export const OtelOutboxMetricsLive = Layer.succeed(OutboxMetricsTag, makeOtelOutboxMetrics());

// Console metrics implementation (for development)
export const makeConsoleOutboxMetrics = (): OutboxMetrics => ({
  incrementClaimed: (count: number) => Effect.logInfo(`Claimed ${count} messages`),
  incrementFailed: (count: number) => Effect.logInfo(`Failed ${count} messages`),
  incrementPublished: (count: number) => Effect.logInfo(`Published ${count} messages`),
  incrementRetries: (count: number) => Effect.logInfo(`Retried ${count} messages`),
  logError: (eventId: string, error: string) =>
    Effect.logError(`Outbox error for ${eventId}: ${error}`),
  recordPublishLatency: (latencyMs: number) => Effect.logInfo(`Publish latency: ${latencyMs}ms`),
  setDlqSize: (size: number) => Effect.logInfo(`DLQ size: ${size}`),
  setQueueDepth: (depth: number) => Effect.logInfo(`Queue depth: ${depth}`),
});

export const ConsoleOutboxMetricsLive = Layer.succeed(OutboxMetricsTag, makeConsoleOutboxMetrics());

// No-op metrics implementation (for production when metrics are disabled)
export const makeNoOpOutboxMetrics = (): OutboxMetrics => ({
  incrementClaimed: () => Effect.void,
  incrementFailed: () => Effect.void,
  incrementPublished: () => Effect.void,
  incrementRetries: () => Effect.void,
  logError: () => Effect.void,
  recordPublishLatency: () => Effect.void,
  setDlqSize: () => Effect.void,
  setQueueDepth: () => Effect.void,
});

export const NoOpOutboxMetricsLive = Layer.succeed(OutboxMetricsTag, makeNoOpOutboxMetrics());
