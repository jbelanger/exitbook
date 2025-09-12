import { NodeSdk } from '@effect/opentelemetry';
import { trace, SpanKind } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
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
  Logger,
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
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: cfg.otlpHttp,
        }),
        exportIntervalMillis: 10000,
      }),
      resource: {
        attributes: {
          'deployment.environment': cfg.environment,
          'service.instance.id': process.env['HOSTNAME'] || `${process.pid}`,
        },
        serviceName: cfg.serviceName,
        serviceVersion: cfg.serviceVersion,
      },
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: cfg.otlpGrpc,
        }),
        {
          maxExportBatchSize: 512,
          maxQueueSize: 2048,
        },
      ),
      tracerConfig: { sampler },
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

// Structured Logger with Trace Correlation
const createStructuredLogger = () => {
  const formatLog = (level: string, message: unknown, span?: Span): string => {
    const timestamp = new Date().toISOString();

    // Extract trace context from current span
    const traceContext: Record<string, string> = {};
    if (span) {
      const spanContext = span.spanContext();
      if (spanContext?.traceId && spanContext?.spanId) {
        traceContext['trace_id'] = spanContext.traceId;
        traceContext['span_id'] = spanContext.spanId;
        traceContext['trace_flags'] = spanContext.traceFlags?.toString() || '01';
      }
    }

    const logEntry = {
      '@timestamp': timestamp,
      environment: process.env['NODE_ENV'] || 'development',
      level: level.toLowerCase(),
      message: typeof message === 'string' ? message : JSON.stringify(message),
      service: process.env['SERVICE_NAME'] || 'exitbook',
      ...traceContext,
    };

    return JSON.stringify(logEntry);
  };

  return Logger.make(({ logLevel, message }) => {
    // Get current active span for trace correlation
    const currentSpan = trace.getActiveSpan();
    const formattedLog = formatLog(logLevel.label, message, currentSpan);

    // Output to stdout/stderr based on log level
    if (logLevel.label === 'ERROR' || logLevel.label === 'FATAL') {
      console.error(formattedLog);
    } else {
      console.log(formattedLog);
    }
  });
};

export const StructuredLoggerLive = Logger.replace(Logger.defaultLogger, createStructuredLogger());

// Logger utilities for common logging patterns with trace correlation
export const logWithTrace = <R>(
  message: string,
  attributes?: Record<string, unknown>,
): Effect.Effect<void, never, R> =>
  Effect.gen(function* () {
    const currentSpan = trace.getActiveSpan();
    const logData = {
      message,
      ...(attributes && { ...attributes }),
      ...(currentSpan && {
        span_id: currentSpan.spanContext().spanId,
        trace_id: currentSpan.spanContext().traceId,
      }),
    };

    yield* Effect.log(logData);
  });

export const logInfo = (message: string, attributes?: Record<string, unknown>) =>
  logWithTrace(message, attributes).pipe(Effect.withLogSpan('info'));

export const logError = (message: string, attributes?: Record<string, unknown>) =>
  logWithTrace(message, attributes).pipe(Effect.withLogSpan('error'));

export const logWarning = (message: string, attributes?: Record<string, unknown>) =>
  logWithTrace(message, attributes).pipe(Effect.withLogSpan('warning'));

export const logDebug = (message: string, attributes?: Record<string, unknown>) =>
  logWithTrace(message, attributes).pipe(Effect.withLogSpan('debug'));

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

// Export the complete monitoring stack with structured logging
export const MonitoringDefault = Layer.mergeAll(
  TelemetryLive,
  HealthMonitorLive,
  StructuredLoggerLive,
);

// Re-export compose functionality
export * from './compose';
