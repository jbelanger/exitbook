import { NodeSdk } from '@effect/opentelemetry';
import { trace, SpanKind } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import {
  Layer,
  Effect,
  Config,
  Metric,
  MetricBoundaries,
  Context,
  Duration,
  Ref,
  Chunk,
} from 'effect';

// Configuration
const TelemetryConfig = Config.all({
  environment: Config.string('NODE_ENV').pipe(Config.withDefault('development')),
  otlpGrpc: Config.string('OTLP_GRPC_ENDPOINT').pipe(Config.withDefault('http://localhost:4317')),
  otlpHttp: Config.string('OTLP_HTTP_ENDPOINT').pipe(Config.withDefault('http://localhost:4318')),
  sampling: Config.number('TRACE_SAMPLING_RATE').pipe(Config.withDefault(0.1)),
  serviceName: Config.string('SERVICE_NAME').pipe(Config.withDefault('exitbook')),
  serviceVersion: Config.string('SERVICE_VERSION').pipe(Config.withDefault('1.0.0')),
});

// Main telemetry layer
export const TelemetryLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const cfg = yield* TelemetryConfig;
    const sampler = new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(cfg.sampling),
    });

    return NodeSdk.layer(() => ({
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
      resource: {
        attributes: {
          'deployment.environment': cfg.environment,
          'service.instance.id': process.env['HOSTNAME'] || `${process.pid}`,
        },
        serviceName: cfg.serviceName,
        serviceVersion: cfg.serviceVersion,
      },
      sampler,
    }));
  }),
);

// OpenTelemetry Semantic Convention Compliant Metrics
export const Metrics = {
  // Cache metrics
  cacheHits: Metric.counter('cache.hits', { description: 'Cache hit count' }),

  cacheMisses: Metric.counter('cache.misses', { description: 'Cache miss count' }),

  // Database (semconv names)
  dbClientOperationDuration: Metric.histogram(
    'db.client.operation.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
  ),
  dlqSize: Metric.gauge('dlq.size', {
    description: 'Current number of messages in dead letter queue',
  }),
  // EventStore (custom but consistent)
  eventstoreAppendDuration: Metric.histogram(
    'eventstore.append.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
  ),

  eventstoreEventsAppended: Metric.counter('eventstore.events.appended', {
    description: 'Number of events appended',
  }),
  eventstoreReadDuration: Metric.histogram(
    'eventstore.read.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
  ),

  // HTTP (semconv names)
  httpServerRequestDuration: Metric.histogram(
    'http.server.request.duration',
    MetricBoundaries.exponential({ count: 20, factor: 2, start: 0.001 }),
  ),
  // Messaging metrics
  messagingPublishDuration: Metric.histogram(
    'messaging.publish.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
  ),

  messagingReceiveDuration: Metric.histogram(
    'messaging.receive.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
  ),
  // Outbox gauges
  outboxQueueDepth: Metric.gauge('outbox.queue.depth', {
    description: 'Current number of pending outbox messages',
  }),

  portfolioValue: Metric.gauge('portfolio.value', { description: 'Current portfolio value' }),
  // Business metrics
  transactionAmount: Metric.counter('transaction.amount', { description: 'Transaction amounts' }),
};

// Health Check Types
export interface HealthCheck {
  readonly check: () => Effect.Effect<
    { details?: unknown; status: 'healthy' | 'unhealthy' },
    never
  >;
  readonly critical: boolean;
  readonly name: string;
  readonly timeout?: Duration.Duration;
}

export interface HealthReport {
  readonly checks: {
    details?: unknown;
    name: string;
    status: 'healthy' | 'unhealthy';
  }[];
  readonly status: 'healthy' | 'unhealthy';
  readonly timestamp: string;
}

// Health Monitor Interface
export interface HealthMonitor {
  readonly getLiveness: () => Effect.Effect<{ body: unknown; status: number }>;
  readonly getReadiness: () => Effect.Effect<{ body: unknown; status: number }>;
  readonly register: (check: HealthCheck) => Effect.Effect<void>;
}

export const HealthMonitorTag = Context.GenericTag<HealthMonitor>('@platform/HealthMonitor');

// Health Monitor Implementation
export const HealthMonitorLive = Layer.effect(
  HealthMonitorTag,
  Effect.gen(function* () {
    const checks = yield* Ref.make(Chunk.empty<HealthCheck>());

    const runCheck = (check: HealthCheck) =>
      check.check().pipe(
        Effect.timeoutTo({
          duration: check.timeout || Duration.seconds(5),
          onSuccess: (result) => result,
          onTimeout: () => ({
            details: { error: 'Health check timeout' },
            status: 'unhealthy' as const,
          }),
        }),
      );

    return {
      getLiveness: () =>
        Effect.succeed({
          body: {
            service: process.env['SERVICE_NAME'] || 'exitbook',
            status: 'alive',
            timestamp: new Date().toISOString(),
            version: process.env['SERVICE_VERSION'] || '1.0.0',
          },
          status: 200,
        }),

      getReadiness: () =>
        Effect.gen(function* () {
          const allChecks = yield* Ref.get(checks);
          const criticalChecks = Chunk.filter(allChecks, (c) => c.critical);

          const results = yield* Effect.forEach(
            criticalChecks,
            (check) =>
              runCheck(check).pipe(
                Effect.map((result) => ({
                  details: result.details,
                  name: check.name,
                  status: result.status,
                })),
              ),
            { concurrency: 'unbounded' },
          );

          const hasUnhealthy = results.some((r) => r.status === 'unhealthy');

          return {
            body: {
              checks: results,
              status: hasUnhealthy ? 'unhealthy' : 'healthy',
              timestamp: new Date().toISOString(),
            },
            status: hasUnhealthy ? 503 : 200,
          };
        }),

      register: (check: HealthCheck) => Ref.update(checks, (list) => Chunk.append(list, check)),
    };
  }),
);

// Tracing Utilities
export const traced = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  kind: SpanKind = SpanKind.INTERNAL,
  attributes?: Record<string, string | number | boolean>,
): Effect.Effect<A, E, R> => {
  const tracer = trace.getTracer('@exitbook/platform', '1.0.0');
  return Effect.acquireUseRelease(
    Effect.sync(() => tracer.startSpan(name, { attributes: attributes || {}, kind })),
    (span) =>
      effect.pipe(
        Effect.tapBoth({
          onFailure: (error) =>
            Effect.sync(() => {
              span.recordException(error instanceof Error ? error : new Error(String(error)));
              span.setStatus({ code: 2 });
            }),
          onSuccess: () =>
            Effect.sync(() => {
              span.setStatus({ code: 1 });
            }),
        }),
      ),
    (span) => Effect.sync(() => span.end()),
  );
};

// Helper functions for common operations
export const recordHttpRequest = (
  method: string,
  route: string,
  statusCode: number,
  durationMs: number,
) =>
  Metric.update(
    Metrics.httpServerRequestDuration.pipe(
      Metric.tagged('http.request.method', method),
      Metric.tagged('http.route', route),
      Metric.tagged('http.response.status_code', String(statusCode)),
    ),
    durationMs / 1000,
  );

export const recordDatabaseQuery = (operation: string, table: string, durationMs: number) =>
  Metric.update(
    Metrics.dbClientOperationDuration.pipe(
      Metric.tagged('db.system', 'postgresql'),
      Metric.tagged('db.operation', operation),
      Metric.tagged('db.sql.table', table),
    ),
    durationMs / 1000,
  );

// Export the complete monitoring stack
export const MonitoringDefault = Layer.mergeAll(TelemetryLive, HealthMonitorLive);
