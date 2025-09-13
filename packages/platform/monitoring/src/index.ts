import { trace, SpanKind } from '@opentelemetry/api';
import { Effect, Metric, MetricBoundaries } from 'effect';

// Re-export from modules
export { TelemetryLive } from './telemetry';
export { HealthMonitorLive, HealthMonitorTag } from './health-monitor';
export type { HealthCheck, HealthReport, HealthMonitor } from './health-monitor';
export {
  StructuredLoggerLive,
  logWithTrace,
  logInfo,
  logError,
  logWarning,
  logDebug,
} from './logger';

// OpenTelemetry Semantic Convention Compliant Metrics
export const Metrics = {
  // Cache metrics
  cacheHits: Metric.counter('cache.hits', { description: 'Cache hit count' }),

  cacheMisses: Metric.counter('cache.misses', { description: 'Cache miss count' }),

  // Database (semconv names)
  dbClientOperationDuration: Metric.histogram(
    'db.client.operation.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
    'Database operation duration in seconds',
  ),
  dlqSize: Metric.gauge('dlq.size', {
    description: 'Current number of messages in dead letter queue',
  }),
  // EventStore (custom but consistent)
  eventstoreAppendDuration: Metric.histogram(
    'eventstore.append.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
    'Event store append duration in seconds',
  ),

  eventstoreEventsAppended: Metric.counter('eventstore.events.appended', {
    description: 'Number of events appended',
  }),
  eventstoreReadDuration: Metric.histogram(
    'eventstore.read.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
    'Event store read duration in seconds',
  ),

  // HTTP (semconv names)
  httpServerRequestDuration: Metric.histogram(
    'http.server.request.duration',
    MetricBoundaries.exponential({ count: 20, factor: 2, start: 0.001 }),
    'HTTP server request duration in seconds',
  ),
  // Messaging metrics
  messagingPublishDuration: Metric.histogram(
    'messaging.publish.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
    'Message publish duration in seconds',
  ),

  messagingReceiveDuration: Metric.histogram(
    'messaging.receive.duration',
    MetricBoundaries.exponential({ count: 15, factor: 2, start: 0.001 }),
    'Message receive processing duration in seconds',
  ),
  // Outbox gauges
  outboxQueueDepth: Metric.gauge('outbox.queue.depth', {
    description: 'Current number of pending outbox messages',
  }),

  portfolioValue: Metric.gauge('portfolio.value', { description: 'Current portfolio value' }),
  // Business metrics
  transactionAmount: Metric.counter('transaction.amount', { description: 'Transaction amounts' }),
};

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
/**
 * Records HTTP request metrics with proper cardinality management.
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param routeTemplate - Route template with parameters (/users/:id, NOT /users/123)
 * @param statusCode - HTTP response status code
 * @param durationMs - Request duration in milliseconds
 *
 * IMPORTANT: Use route templates (/users/:id) to avoid cardinality explosion.
 * Never pass raw paths with actual IDs or dynamic values.
 */
export const recordHttpRequest = (
  method: string,
  routeTemplate: string,
  statusCode: number,
  durationMs: number,
) => {
  // Validate route template to catch common mistakes
  if (
    routeTemplate.match(/\/\d+/) ||
    routeTemplate.match(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  ) {
    console.warn(
      `[Monitoring] Potential cardinality issue: route "${routeTemplate}" contains actual values. ` +
        `Use route templates like "/users/:id" instead of actual paths like "/users/123"`,
    );
  }

  return Metric.update(
    Metrics.httpServerRequestDuration.pipe(
      Metric.tagged('http.request.method', method.toUpperCase()),
      Metric.tagged('http.route', routeTemplate),
      Metric.tagged('http.response.status_code', String(statusCode)),
    ),
    durationMs / 1000, // Convert to seconds for semantic conventions
  );
};

/**
 * Records database query metrics with proper units (seconds).
 *
 * @param operation - Database operation (SELECT, INSERT, UPDATE, DELETE)
 * @param table - Database table name
 * @param durationMs - Query duration in milliseconds
 */
export const recordDatabaseQuery = (operation: string, table: string, durationMs: number) =>
  Metric.update(
    Metrics.dbClientOperationDuration.pipe(
      Metric.tagged('db.system', 'postgresql'),
      Metric.tagged('db.operation', operation.toUpperCase()),
      Metric.tagged('db.sql.table', table),
    ),
    durationMs / 1000, // Convert to seconds for semantic conventions
  );

// Unit conversion utilities for consistent metric recording
/**
 * Converts milliseconds to seconds for histogram metrics.
 * All latency histograms follow OpenTelemetry semantic conventions (seconds).
 */
export const msToSeconds = (ms: number): number => ms / 1000;

/**
 * Helper to record any duration metric with consistent units.
 * Always converts from milliseconds to seconds.
 *
 * Example usage:
 * recordDurationMetric(Metrics.httpServerRequestDuration, 150, {
 *   'http.method': 'GET',
 *   'http.route': '/api/users/:id'
 * });
 */
export const recordDurationMetric = (
  metric: ReturnType<typeof Metric.histogram>,
  durationMs: number,
  tags?: Record<string, string>,
) => {
  if (!tags || Object.keys(tags).length === 0) {
    return Metric.update(metric, msToSeconds(durationMs));
  }

  // Apply tags sequentially
  let taggedMetric = metric;
  for (const [key, value] of Object.entries(tags)) {
    taggedMetric = taggedMetric.pipe(Metric.tagged(key, value));
  }
  return Metric.update(taggedMetric, msToSeconds(durationMs));
};

/**
 * Registers graceful shutdown handlers to ensure telemetry data is flushed.
 * Call this once in your application's main function.
 *
 * The NodeSdk.layer handles shutdown automatically when the layer is properly
 * disposed, but this provides additional safety for direct process.exit() calls.
 */
export const registerGracefulShutdown = () => {
  let shutdownInProgress = false;

  const gracefulShutdown = (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    console.log(`[Monitoring] Received ${signal}, starting graceful shutdown...`);

    // Give telemetry time to flush (NodeSdk BatchSpanProcessor has default 30s timeout)
    const shutdownTimeout = setTimeout(() => {
      console.error('[Monitoring] Shutdown timeout - forcing exit');
      process.exit(1);
    }, 5000); // 5 second timeout

    // Allow time for telemetry to flush
    setTimeout(() => {
      clearTimeout(shutdownTimeout);
      console.log('[Monitoring] Graceful shutdown complete');
      process.exit(0);
    }, 1000); // 1 second delay for flush
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    console.error('[Monitoring] Uncaught exception:', error);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Monitoring] Unhandled rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
  });
};

// Re-export compose functionality and MonitoringDefault
export { MonitoringDefault } from './compose';
export * from './compose';

// Re-export health checks
export {
  InfrastructureHealthChecks,
  createDatabaseHealthCheck,
  createMessageBrokerHealthCheck,
} from './health-checks';
