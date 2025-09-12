# Monitoring & Observability Implementation

## Package Structure & Dependencies

### Monitoring Package

```json name=packages/platform/monitoring/package.json
{
  "name": "@exitbook/platform-monitoring",
  "version": "0.0.0",
  "private": true,
  "sideEffects": false,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "clean": "rimraf dist",
    "dev": "tsc -b -w",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "prettier": "prettier --check .",
    "prettier:fix": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@effect/opentelemetry": "^0.56.0",
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/auto-instrumentations-node": "^0.54.0",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.54.0",
    "@opentelemetry/exporter-trace-otlp-grpc": "^0.54.0",
    "@opentelemetry/resources": "^1.26.0",
    "@opentelemetry/sdk-metrics": "^1.26.0",
    "@opentelemetry/sdk-trace-base": "^1.26.0",
    "@opentelemetry/semantic-conventions": "^1.27.0",
    "effect": "^3.17.13"
  },
  "devDependencies": {
    "@internal/tsconfig": "workspace:*",
    "@types/node": "^24.3.1",
    "rimraf": "^5.0.0"
  }
}
```

```typescript name=packages/platform/monitoring/tsconfig.json
{
  "extends": "@internal/tsconfig/node",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules"]
}
```

## Core Monitoring Implementation

```typescript name=packages/platform/monitoring/src/index.ts
import { NodeSdk } from '@effect/opentelemetry';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
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
import { trace, SpanKind } from '@opentelemetry/api';

// Configuration
const TelemetryConfig = Config.all({
  serviceName: Config.string('SERVICE_NAME').pipe(
    Config.withDefault('exitbook'),
  ),
  serviceVersion: Config.string('SERVICE_VERSION').pipe(
    Config.withDefault('1.0.0'),
  ),
  environment: Config.string('NODE_ENV').pipe(
    Config.withDefault('development'),
  ),
  otlpGrpc: Config.string('OTLP_GRPC_ENDPOINT').pipe(
    Config.withDefault('http://localhost:4317'),
  ),
  otlpHttp: Config.string('OTLP_HTTP_ENDPOINT').pipe(
    Config.withDefault('http://localhost:4318'),
  ),
  sampling: Config.number('TRACE_SAMPLING_RATE').pipe(Config.withDefault(0.1)),
});

// Main telemetry layer
export const TelemetryLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const cfg = yield* TelemetryConfig;
    const sampler = new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(cfg.sampling),
    });

    return NodeSdk.layer(() => ({
      resource: {
        serviceName: cfg.serviceName,
        serviceVersion: cfg.serviceVersion,
        attributes: {
          'deployment.environment': cfg.environment,
          'service.instance.id': process.env['HOSTNAME'] || `${process.pid}`,
        },
      },
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
      spanProcessor: {
        create: (exporter) =>
          new BatchSpanProcessor(exporter, {
            maxQueueSize: 2048,
            maxExportBatchSize: 512,
          }),
      },
      traceExporter: { endpoint: cfg.otlpGrpc },
      metricReader: {
        endpoint: cfg.otlpHttp,
        exportIntervalMillis: 10000,
      },
      sampler,
    }));
  }),
);

// OpenTelemetry Semantic Convention Compliant Metrics
export const Metrics = {
  // HTTP (semconv names)
  httpServerRequestDuration: Metric.histogram(
    'http.server.request.duration',
    MetricBoundaries.exponential(0.001, 2, 20),
    'HTTP server request duration in seconds',
  ),

  // Database (semconv names)
  dbClientOperationDuration: Metric.histogram(
    'db.client.operation.duration',
    MetricBoundaries.exponential(0.001, 2, 15),
    'Database operation duration in seconds',
  ),

  // EventStore (custom but consistent)
  eventstoreAppendDuration: Metric.histogram(
    'eventstore.append.duration',
    MetricBoundaries.exponential(0.001, 2, 15),
    'Event store append duration in seconds',
  ),
  eventstoreEventsAppended: Metric.counter(
    'eventstore.events.appended',
    'Number of events appended',
  ),
  eventstoreReadDuration: Metric.histogram(
    'eventstore.read.duration',
    MetricBoundaries.exponential(0.001, 2, 15),
    'Event store read duration in seconds',
  ),

  // Outbox gauges
  outboxQueueDepth: Metric.gauge(
    'outbox.queue.depth',
    'Current number of pending outbox messages',
  ),
  dlqSize: Metric.gauge(
    'dlq.size',
    'Current number of messages in dead letter queue',
  ),

  // Messaging metrics
  messagingPublishDuration: Metric.histogram(
    'messaging.publish.duration',
    MetricBoundaries.exponential(0.001, 2, 15),
    'Message publish duration in seconds',
  ),
  messagingReceiveDuration: Metric.histogram(
    'messaging.receive.duration',
    MetricBoundaries.exponential(0.001, 2, 15),
    'Message receive processing duration in seconds',
  ),

  // Cache metrics
  cacheHits: Metric.counter('cache.hits', 'Cache hit count'),
  cacheMisses: Metric.counter('cache.misses', 'Cache miss count'),

  // Business metrics
  transactionAmount: Metric.counter(
    'transaction.amount',
    'Transaction amounts',
  ),
  portfolioValue: Metric.gauge('portfolio.value', 'Current portfolio value'),
};

// Health Check Types
export interface HealthCheck {
  readonly name: string;
  readonly check: () => Effect.Effect<
    { status: 'healthy' | 'unhealthy'; details?: unknown },
    never
  >;
  readonly critical: boolean;
  readonly timeout?: Duration.Duration;
}

export interface HealthReport {
  readonly status: 'healthy' | 'unhealthy';
  readonly checks: Array<{
    name: string;
    status: 'healthy' | 'unhealthy';
    details?: unknown;
  }>;
  readonly timestamp: string;
}

// Health Monitor Interface
export interface HealthMonitor {
  readonly register: (check: HealthCheck) => Effect.Effect<void>;
  readonly getLiveness: () => Effect.Effect<{ status: number; body: unknown }>;
  readonly getReadiness: () => Effect.Effect<{ status: number; body: unknown }>;
}

export const HealthMonitorTag = Context.GenericTag<HealthMonitor>(
  '@platform/HealthMonitor',
);

// Health Monitor Implementation
export const HealthMonitorLive = Layer.effect(
  HealthMonitorTag,
  Effect.gen(function* () {
    const checks = yield* Ref.make(Chunk.empty<HealthCheck>());

    const runCheck = (check: HealthCheck) =>
      check.check().pipe(
        Effect.timeoutTo({
          duration: check.timeout || Duration.seconds(5),
          onTimeout: () =>
            Effect.succeed({
              status: 'unhealthy' as const,
              details: { error: 'Health check timeout' },
            }),
        }),
      );

    return {
      register: (check: HealthCheck) =>
        Ref.update(checks, (list) => Chunk.append(list, check)),

      getLiveness: () =>
        Effect.succeed({
          status: 200,
          body: {
            status: 'alive',
            timestamp: new Date().toISOString(),
            service: process.env['SERVICE_NAME'] || 'exitbook',
            version: process.env['SERVICE_VERSION'] || '1.0.0',
          },
        }),

      getReadiness: () =>
        Effect.gen(function* () {
          const allChecks = yield* Ref.get(checks);
          const criticalChecks = Chunk.filter(allChecks, (c) => c.critical);

          const results = yield* Effect.forEach(
            criticalChecks,
            (check) =>
              runCheck(check).pipe(
                Effect.map((result) => ({ name: check.name, ...result })),
              ),
            { concurrency: 'unbounded' },
          );

          const hasUnhealthy = Chunk.some(
            results,
            (r) => r.status === 'unhealthy',
          );

          return {
            status: hasUnhealthy ? 503 : 200,
            body: {
              status: hasUnhealthy ? 'unhealthy' : 'healthy',
              checks: Chunk.toArray(results),
              timestamp: new Date().toISOString(),
            },
          };
        }),
    };
  }),
);

// Tracing Utilities
export const traced = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  kind: SpanKind = SpanKind.INTERNAL,
  attributes?: Record<string, unknown>,
): Effect.Effect<A, E, R> => {
  const tracer = trace.getTracer('@exitbook/platform', '1.0.0');
  return Effect.acquireUseRelease(
    Effect.sync(() => tracer.startSpan(name, { kind, attributes })),
    (span) =>
      effect.pipe(
        Effect.tapBoth({
          onSuccess: () =>
            Effect.sync(() => {
              span.setStatus({ code: 1 });
            }),
          onFailure: (error) =>
            Effect.sync(() => {
              span.recordException(
                error instanceof Error ? error : new Error(String(error)),
              );
              span.setStatus({ code: 2 });
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

export const recordDatabaseQuery = (
  operation: string,
  table: string,
  durationMs: number,
) =>
  Metric.update(
    Metrics.dbClientOperationDuration.pipe(
      Metric.tagged('db.system', 'postgresql'),
      Metric.tagged('db.operation', operation),
      Metric.tagged('db.sql.table', table),
    ),
    durationMs / 1000,
  );

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
        traceContext['trace_flags'] =
          spanContext.traceFlags?.toString() || '01';
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

export const StructuredLoggerLive = Logger.replace(
  Logger.defaultLogger,
  createStructuredLogger(),
);

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

export const logInfo = (
  message: string,
  attributes?: Record<string, unknown>,
) => logWithTrace(message, attributes).pipe(Effect.withLogSpan('info'));

export const logError = (
  message: string,
  attributes?: Record<string, unknown>,
) => logWithTrace(message, attributes).pipe(Effect.withLogSpan('error'));

export const logWarning = (
  message: string,
  attributes?: Record<string, unknown>,
) => logWithTrace(message, attributes).pipe(Effect.withLogSpan('warning'));

export const logDebug = (
  message: string,
  attributes?: Record<string, unknown>,
) => logWithTrace(message, attributes).pipe(Effect.withLogSpan('debug'));

// Export the complete monitoring stack with structured logging
export const MonitoringDefault = Layer.mergeAll(
  TelemetryLive,
  HealthMonitorLive,
  StructuredLoggerLive,
);
```

## EventStore Monitoring Wrapper

```typescript name=packages/platform/monitoring/src/event-store.ts
import { Effect, Layer, pipe, Metric } from 'effect';
import { EventStoreTag, type EventStore } from '@exitbook/platform-event-store';
import { trace, SpanKind } from '@opentelemetry/api';
import { Metrics } from './index';

export const MonitoredEventStoreLive = Layer.effect(
  EventStoreTag,
  Effect.gen(function* () {
    const store = yield* EventStoreTag;
    const tracer = trace.getTracer('@exitbook/event-store', '1.0.0');

    return {
      ...store,

      appendAndReturn: (stream, events, version, options) =>
        pipe(
          Effect.Do,
          Effect.bind('span', () =>
            Effect.sync(() =>
              tracer.startSpan('eventstore.append', {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'eventstore',
                  'db.operation': 'append',
                  'eventstore.stream': stream,
                  'eventstore.event.count': events.length,
                  'eventstore.expected.version': version,
                },
              }),
            ),
          ),
          Effect.bind('started', () => Effect.sync(() => Date.now())),
          Effect.bind('result', ({ span }) =>
            store.appendAndReturn(stream, events, version, options).pipe(
              Effect.tapBoth({
                onSuccess: () => Effect.sync(() => span.setStatus({ code: 1 })),
                onFailure: (e) =>
                  Effect.sync(() => {
                    span.recordException(
                      e instanceof Error ? e : new Error(String(e)),
                    );
                    span.setStatus({ code: 2 });
                  }),
              }),
            ),
          ),
          Effect.tap(({ started, span }) =>
            Effect.sync(() => {
              const duration = (Date.now() - started) / 1000;
              Metric.update(Metrics.eventstoreAppendDuration, duration);
              Metric.update(Metrics.eventstoreEventsAppended, events.length);
              span.end();
            }),
          ),
          Effect.map(({ result }) => result),
        ),

      readStream: (stream, fromVersion) =>
        pipe(
          Effect.Do,
          Effect.bind('span', () =>
            Effect.sync(() =>
              tracer.startSpan('eventstore.read', {
                kind: SpanKind.CLIENT,
                attributes: {
                  'db.system': 'eventstore',
                  'db.operation': 'read',
                  'eventstore.stream': stream,
                  'eventstore.from.version': fromVersion,
                },
              }),
            ),
          ),
          Effect.bind('started', () => Effect.sync(() => Date.now())),
          Effect.bind('result', ({ span }) =>
            store.readStream(stream, fromVersion).pipe(
              Effect.tapBoth({
                onSuccess: () => Effect.sync(() => span.setStatus({ code: 1 })),
                onFailure: (e) =>
                  Effect.sync(() => {
                    span.recordException(
                      e instanceof Error ? e : new Error(String(e)),
                    );
                    span.setStatus({ code: 2 });
                  }),
              }),
            ),
          ),
          Effect.tap(({ started, span }) =>
            Effect.sync(() => {
              const duration = (Date.now() - started) / 1000;
              Metric.update(Metrics.eventstoreReadDuration, duration);
              span.end();
            }),
          ),
          Effect.map(({ result }) => result),
        ),

      readAll: (fromPosition, batchSize) =>
        traced(
          'eventstore.readAll',
          store.readAll(fromPosition, batchSize),
          SpanKind.CLIENT,
          {
            'db.system': 'eventstore',
            'db.operation': 'readAll',
            'eventstore.from.position': fromPosition.toString(),
            'eventstore.batch.size': batchSize,
          },
        ),

      readCategory: (category, fromPosition, batchSize) =>
        traced(
          'eventstore.readCategory',
          store.readCategory(category, fromPosition, batchSize),
          SpanKind.CLIENT,
          {
            'db.system': 'eventstore',
            'db.operation': 'readCategory',
            'eventstore.category': category,
            'eventstore.from.position': fromPosition.toString(),
            'eventstore.batch.size': batchSize,
          },
        ),

      healthCheck: store.healthCheck,
      loadSnapshot: store.loadSnapshot,
      saveSnapshot: store.saveSnapshot,
    } satisfies EventStore;
  }),
);
```

## Updated Messaging with Trace Propagation

```json name=packages/platform/messaging/package.json
{
  "name": "@exitbook/platform-messaging",
  "version": "0.0.0",
  "private": true,
  "sideEffects": false,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./compose/*": {
      "types": "./dist/compose/*.d.ts",
      "default": "./dist/compose/*.js"
    }
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "clean": "rimraf dist",
    "dev": "tsc -b -w",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "prettier": "prettier --check .",
    "prettier:fix": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@types/amqplib": "^0.10.7",
    "amqp-connection-manager": "^4.1.14",
    "amqplib": "^0.10.9",
    "cloudevents": "^10.0.0",
    "effect": "^3.17.13"
  },
  "devDependencies": {
    "@internal/tsconfig": "workspace:*",
    "@types/node": "^24.3.1",
    "rimraf": "^5.0.10"
  }
}
```

```typescript name=packages/platform/messaging/src/internal/impl/make-producer.ts
import { Effect, pipe, Layer } from 'effect';
import { context as otelContext, propagation } from '@opentelemetry/api';
import type { MessageBusProducer, MessageTransport } from '../../port';
import { MessageBusProducerTag, MessageTransportTag } from '../../port';
import { CloudEvents } from '../../util/toCloudEvent';

const looksLikeCloudEvent = (payload: unknown): boolean => {
  try {
    const obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return (
      obj && typeof obj === 'object' && 'type' in obj && 'specversion' in obj
    );
  } catch {
    return false;
  }
};

export const makeMessageBusProducer = (
  transport: MessageTransport,
): MessageBusProducer => ({
  healthCheck: () =>
    pipe(
      transport.healthCheck(),
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    ),

  publish: (topic: string, payload: unknown, opts?) => {
    const headers: Record<string, string> = {
      'content-type': 'application/cloudevents+json',
    };

    // Inject W3C trace context
    propagation.inject(otelContext.active(), headers);

    const payloadJson = looksLikeCloudEvent(payload)
      ? typeof payload === 'string'
        ? payload
        : JSON.stringify(payload)
      : JSON.stringify(
          CloudEvents.create(topic, payload, {
            causationId: opts?.causationId,
            correlationId: opts?.correlationId,
            userId: opts?.userId,
          }),
        );

    return transport.publish(topic, payloadJson, {
      ...(opts?.key && { key: opts.key }),
      headers,
      ...(opts?.timeoutMs && { timeoutMs: opts.timeoutMs }),
    });
  },

  publishBatch: (topic: string, items) => {
    const enrichedMessages = items.map((item) => {
      const headers: Record<string, string> = {
        'content-type': 'application/cloudevents+json',
      };

      // Inject trace context for each message
      propagation.inject(otelContext.active(), headers);

      return {
        ...(item.opts?.key && { key: item.opts.key }),
        headers,
        ...(item.opts?.timeoutMs && { timeoutMs: item.opts.timeoutMs }),
        payload: looksLikeCloudEvent(item.payload)
          ? typeof item.payload === 'string'
            ? item.payload
            : JSON.stringify(item.payload)
          : JSON.stringify(
              CloudEvents.create(topic, item.payload, {
                causationId: item.opts?.causationId,
                correlationId: item.opts?.correlationId,
                userId: item.opts?.userId,
              }),
            ),
      };
    });

    return transport.publishBatch(topic, enrichedMessages);
  },
});

export const MessageBusProducerLive = Layer.effect(
  MessageBusProducerTag,
  Effect.map(MessageTransportTag, (transport) =>
    makeMessageBusProducer(transport),
  ),
);
```

```typescript name=packages/platform/messaging/src/internal/impl/make-consumer.ts
import { CloudEvent } from 'cloudevents';
import { Effect, Layer } from 'effect';
import {
  context as otelContext,
  propagation,
  trace,
  SpanKind,
} from '@opentelemetry/api';
import type {
  MessageBusConsumer,
  MessageTransport,
  Subscription,
  IncomingMessage,
} from '../../port';
import { MessageBusConsumerTag, MessageTransportTag } from '../../port';

export const makeMessageBusConsumer = (
  transport: MessageTransport,
): MessageBusConsumer => ({
  subscribe: (topic: string, groupId: string, handler) =>
    Effect.map(
      transport.subscribe(topic, groupId, (message) => {
        // Extract W3C trace context from message headers
        const ctx = propagation.extract(otelContext.active(), message.headers);
        const tracer = trace.getTracer('@exitbook/messaging', '1.0.0');

        // Start a CONSUMER span
        const span = tracer.startSpan(`${topic} receive`, {
          kind: SpanKind.CONSUMER,
          attributes: {
            'messaging.system': 'rabbitmq',
            'messaging.destination.name': topic,
            'messaging.consumer.group.name': groupId,
            ...(message.key && { 'messaging.message.id': message.key }),
          },
        });

        // Run handler in the extracted context with span
        return otelContext.with(trace.setSpan(ctx, span), () => {
          const obj =
            typeof message.payload === 'string'
              ? JSON.parse(message.payload)
              : message.payload;
          const ce = new CloudEvent(obj as Partial<CloudEvent>);

          const incomingMessage: IncomingMessage = {
            headers: message.headers,
            key: message.key,
            offset: message.offset,
            payload: ce.data,
          };

          return handler(incomingMessage).pipe(
            Effect.tapBoth({
              onSuccess: () =>
                Effect.sync(() => {
                  span.setStatus({ code: 1 });
                  span.end();
                }),
              onFailure: (error) =>
                Effect.sync(() => {
                  span.recordException(
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  span.setStatus({ code: 2 });
                  span.end();
                }),
            }),
          );
        });
      }),
      (): Subscription => ({
        stop: () => Effect.orDie(transport.unsubscribe(topic, groupId)),
      }),
    ),
});

export const MessageBusConsumerLive = Layer.effect(
  MessageBusConsumerTag,
  Effect.map(MessageTransportTag, makeMessageBusConsumer),
);
```

## Outbox Worker with Real Metrics

```typescript name=packages/platform/events/outbox-worker/src/metrics.ts
import { Context, Effect, Layer, Metric, MetricBoundaries } from 'effect';

export interface OutboxMetrics {
  incrementClaimed(count: number): Effect.Effect<void>;
  incrementFailed(count: number): Effect.Effect<void>;
  incrementPublished(count: number): Effect.Effect<void>;
  incrementRetries(count: number): Effect.Effect<void>;
  logError(eventId: string, error: string): Effect.Effect<void>;
  recordPublishLatency(latencyMs: number): Effect.Effect<void>;
  setQueueDepth(depth: number): Effect.Effect<void>;
  setDlqSize(size: number): Effect.Effect<void>;
}

export const OutboxMetricsTag = Context.GenericTag<OutboxMetrics>(
  '@exitbook/outbox-worker/OutboxMetrics',
);

// OTEL metrics implementation
const publishLatency = Metric.histogram(
  'outbox.publish.duration',
  MetricBoundaries.exponential(0.001, 2, 15),
  'Outbox message publish duration in seconds',
);

const claimed = Metric.counter(
  'outbox.messages.claimed',
  'Messages claimed from outbox',
);
const published = Metric.counter(
  'outbox.messages.published',
  'Messages successfully published',
);
const failed = Metric.counter(
  'outbox.messages.failed',
  'Messages failed to publish',
);
const retried = Metric.counter(
  'outbox.messages.retried',
  'Messages scheduled for retry',
);
const queueDepth = Metric.gauge(
  'outbox.queue.depth',
  'Current outbox queue depth',
);
const dlqSize = Metric.gauge('dlq.size', 'Current DLQ size');

export const makeOtelOutboxMetrics = (): OutboxMetrics => ({
  incrementClaimed: (count: number) => Metric.update(claimed, count),
  incrementFailed: (count: number) => Metric.update(failed, count),
  incrementPublished: (count: number) => Metric.update(published, count),
  incrementRetries: (count: number) => Metric.update(retried, count),
  logError: (eventId: string, error: string) =>
    Effect.logError(`Outbox error for ${eventId}: ${error}`),
  recordPublishLatency: (latencyMs: number) =>
    Metric.update(publishLatency, latencyMs / 1000),
  setQueueDepth: (depth: number) => Metric.set(queueDepth, depth),
  setDlqSize: (size: number) => Metric.set(dlqSize, size),
});

export const OtelOutboxMetricsLive = Layer.succeed(
  OutboxMetricsTag,
  makeOtelOutboxMetrics(),
);

// Console implementation for development
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
    Effect.sync(() =>
      console.error(`[OutboxMetrics] Error for event ${eventId}: ${error}`),
    ),
  recordPublishLatency: (latencyMs: number) =>
    Effect.sync(() =>
      console.log(`[OutboxMetrics] Publish latency: ${latencyMs}ms`),
    ),
  setQueueDepth: (depth: number) =>
    Effect.sync(() => console.log(`[OutboxMetrics] Queue depth: ${depth}`)),
  setDlqSize: (size: number) =>
    Effect.sync(() => console.log(`[OutboxMetrics] DLQ size: ${size}`)),
});

export const ConsoleOutboxMetricsLive = Layer.succeed(
  OutboxMetricsTag,
  makeConsoleOutboxMetrics(),
);

// No-op implementation for testing
export const makeNoOpOutboxMetrics = (): OutboxMetrics => ({
  incrementClaimed: () => Effect.void,
  incrementFailed: () => Effect.void,
  incrementPublished: () => Effect.void,
  incrementRetries: () => Effect.void,
  logError: () => Effect.void,
  recordPublishLatency: () => Effect.void,
  setQueueDepth: () => Effect.void,
  setDlqSize: () => Effect.void,
});

export const NoOpOutboxMetricsLive = Layer.succeed(
  OutboxMetricsTag,
  makeNoOpOutboxMetrics(),
);
```

```typescript name=packages/platform/events/outbox-worker/src/compose/live.ts
import { EventStoreWithOutboxDefault } from '@exitbook/platform-event-store/compose/live';
import { MessageBusDefault } from '@exitbook/platform-messaging';
import { MonitoringDefault } from '@exitbook/platform-monitoring';
import { Layer, Effect } from 'effect';

import {
  OutboxDaemonLive,
  OutboxDaemonTag,
  type DaemonConfig,
  defaultDaemonConfig,
} from '../daemon';
import { OtelOutboxMetricsLive } from '../metrics';
import { OutboxProcessorLive, defaultOutboxConfig } from '../processor';

// Base dependencies with real metrics and monitoring
const BaseDeps = Layer.mergeAll(
  EventStoreWithOutboxDefault,
  MessageBusDefault,
  OtelOutboxMetricsLive,
  MonitoringDefault,
);

const ProcessorProvided = Layer.provide(
  OutboxProcessorLive(defaultOutboxConfig),
  BaseDeps,
);

export const OutboxWorkerDefault = Layer.provide(
  OutboxDaemonLive(defaultDaemonConfig),
  ProcessorProvided,
);

export const runOutboxDaemon = (config?: Partial<DaemonConfig>) => {
  const program = Effect.gen(function* () {
    const daemon = yield* OutboxDaemonTag;
    yield* daemon.start();
    yield* Effect.never;
  });

  if (config) {
    const fullConfig = { ...defaultDaemonConfig, ...config };
    const customWorkerLayer = Layer.provide(
      OutboxDaemonLive(fullConfig),
      Layer.provide(OutboxProcessorLive(fullConfig), BaseDeps),
    );
    return Effect.provide(program, customWorkerLayer);
  }

  return Effect.provide(program, OutboxWorkerDefault);
};
```

## Event Bus with Monitoring

```typescript name=packages/platform/events/event-bus/src/compose/live.ts
import {
  EventStoreDefault,
  EventStoreTag,
} from '@exitbook/platform-event-store';
import {
  MessageBusDefault,
  MessageBusProducerTag,
} from '@exitbook/platform-messaging';
import {
  MonitoringDefault,
  MonitoredEventStoreLive,
} from '@exitbook/platform-monitoring';
import { Layer, Effect } from 'effect';

import { makePgCheckpointStore } from '../adapters/pg-checkpoint-store';
import { CheckpointStoreTag } from '../checkpoint-store';
import { UnifiedEventBusTag, makeUnifiedEventBus } from '../event-bus';

export const CheckpointStoreLive = Layer.effect(
  CheckpointStoreTag,
  makePgCheckpointStore(),
);

export const UnifiedEventBusLive = Layer.effect(
  UnifiedEventBusTag,
  Effect.gen(function* () {
    const es = yield* EventStoreTag;
    const prod = yield* MessageBusProducerTag;
    const cp = yield* CheckpointStoreTag;
    const ueb = yield* makeUnifiedEventBus(es, prod, cp);
    return ueb;
  }),
);

// Complete stack with monitoring
export const UnifiedEventBusDefault = Layer.provide(
  UnifiedEventBusLive,
  Layer.mergeAll(
    MonitoringDefault,
    Layer.provide(MonitoredEventStoreLive, EventStoreDefault),
    MessageBusDefault,
    CheckpointStoreLive,
  ),
);
```

## Infrastructure Health Checks

```typescript name=packages/platform/monitoring/src/health-checks.ts
import { Effect, Layer, Duration } from 'effect';
import { HealthMonitorTag } from './index';
import { DatabasePool } from '@exitbook/platform-database';
import { MessageTransportTag } from '@exitbook/platform-messaging';

export const InfrastructureHealthChecks = Layer.effect(
  HealthMonitorTag,
  Effect.gen(function* () {
    const monitor = yield* HealthMonitorTag;
    const dbPool = yield* DatabasePool;
    const transport = yield* MessageTransportTag;

    // PostgreSQL health check
    yield* monitor.register({
      name: 'postgresql',
      critical: true,
      timeout: Duration.seconds(5),
      check: () =>
        Effect.tryPromise(() => dbPool.pool.query('SELECT 1')).pipe(
          Effect.map(() => ({ status: 'healthy' as const })),
          Effect.catchAll(() =>
            Effect.succeed({
              status: 'unhealthy' as const,
              details: { error: 'Database connection failed' },
            }),
          ),
        ),
    });

    // RabbitMQ health check
    yield* monitor.register({
      name: 'rabbitmq',
      critical: true,
      timeout: Duration.seconds(5),
      check: () =>
        transport.healthCheck().pipe(
          Effect.map(() => ({ status: 'healthy' as const })),
          Effect.catchAll(() =>
            Effect.succeed({
              status: 'unhealthy' as const,
              details: { error: 'Message broker connection failed' },
            }),
          ),
        ),
    });

    // Redis health check (if you have cache)
    // yield* monitor.register({
    //   name: 'redis',
    //   critical: false,
    //   timeout: Duration.seconds(3),
    //   check: () => ...
    // });

    return monitor;
  }),
);
```

## Docker Compose for Local Monitoring Stack

```yaml name=infra/docker/monitoring-stack.yml
version: '3.8'

services:
  # OpenTelemetry Collector
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    command: ['--config=/etc/otel-collector.yaml']
    volumes:
      - ./configs/otel-collector.yaml:/etc/otel-collector.yaml
    ports:
      - '4317:4317' # OTLP gRPC
      - '4318:4318' # OTLP HTTP
      - '8888:8888' # Prometheus metrics
      - '13133:13133' # Health check

  # Prometheus
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./configs/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./configs/alerts.yml:/etc/prometheus/alerts.yml
      - prometheus-data:/prometheus
    ports:
      - '9090:9090'
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.enable-lifecycle'
      - '--web.enable-remote-write-receiver'

  # Grafana
  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_FEATURE_TOGGLES_ENABLE=traceToMetrics
    volumes:
      - ./grafana/dashboards:/var/lib/grafana/dashboards
      - ./grafana/provisioning:/etc/grafana/provisioning
      - grafana-data:/var/lib/grafana
    ports:
      - '3000:3000'
    depends_on:
      - prometheus
      - tempo
      - loki

  # Tempo for traces
  tempo:
    image: grafana/tempo:latest
    command: ['-config.file=/etc/tempo.yaml']
    volumes:
      - ./configs/tempo.yaml:/etc/tempo.yaml
      - tempo-data:/tmp/tempo
    ports:
      - '3200:3200' # Tempo
      - '9095:9095' # Tempo gRPC

  # Loki for logs
  loki:
    image: grafana/loki:latest
    ports:
      - '3100:3100'
    volumes:
      - ./configs/loki.yaml:/etc/loki/local-config.yaml
      - loki-data:/loki
    command: -config.file=/etc/loki/local-config.yaml

volumes:
  prometheus-data:
  grafana-data:
  tempo-data:
  loki-data:
```

```yaml name=infra/docker/configs/otel-collector.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

exporters:
  prometheus:
    endpoint: '0.0.0.0:8888'

  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true

  loki:
    endpoint: http://loki:3100/loki/api/v1/push

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo]

    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]

    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [loki]

  extensions: [health_check]
```

```yaml name=infra/docker/configs/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: []

rule_files:
  - 'alerts.yml'

scrape_configs:
  - job_name: 'otel-collector'
    static_configs:
      - targets: ['otel-collector:8888']
```

```yaml name=infra/docker/configs/alerts.yml
groups:
  - name: event_sourcing
    interval: 30s
    rules:
      - alert: HighEventAppendLatency
        expr:
          histogram_quantile(0.95, rate(eventstore_append_duration_bucket[5m]))
          > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'Event append p95 latency is high ({{ $value }}s)'

      - alert: OutboxBacklog
        expr: outbox_queue_depth > 10000
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: 'Outbox queue depth is {{ $value }}'

      - alert: DLQNotEmpty
        expr: dlq_size > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'DLQ has {{ $value }} messages'

  - name: infrastructure
    interval: 30s
    rules:
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'Service {{ $labels.instance }} is down'

      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes / 1024 / 1024 > 512
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'High memory usage: {{ $value }}MB'
```

## Grafana Dashboard

```json name=infra/docker/grafana/dashboards/event-sourcing.json
{
  "dashboard": {
    "title": "Event Sourcing System",
    "uid": "event-sourcing",
    "panels": [
      {
        "title": "Event Append Rate",
        "targets": [
          {
            "expr": "rate(eventstore_events_appended_total[5m])",
            "legendFormat": "{{stream}}"
          }
        ],
        "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 }
      },
      {
        "title": "Event Append Latency (p50, p95, p99)",
        "targets": [
          {
            "expr": "histogram_quantile(0.50, rate(eventstore_append_duration_bucket[5m]))",
            "legendFormat": "p50"
          },
          {
            "expr": "histogram_quantile(0.95, rate(eventstore_append_duration_bucket[5m]))",
            "legendFormat": "p95"
          },
          {
            "expr": "histogram_quantile(0.99, rate(eventstore_append_duration_bucket[5m]))",
            "legendFormat": "p99"
          }
        ],
        "gridPos": { "h": 8, "w": 12, "x": 12, "y": 0 }
      },
      {
        "title": "Outbox Queue Depth",
        "targets": [
          {
            "expr": "outbox_queue_depth"
          }
        ],
        "gridPos": { "h": 8, "w": 12, "x": 0, "y": 8 }
      },
      {
        "title": "Outbox Processing Rate",
        "targets": [
          {
            "expr": "rate(outbox_messages_published_total[5m])",
            "legendFormat": "Published"
          },
          {
            "expr": "rate(outbox_messages_failed_total[5m])",
            "legendFormat": "Failed"
          },
          {
            "expr": "rate(outbox_messages_retried_total[5m])",
            "legendFormat": "Retried"
          }
        ],
        "gridPos": { "h": 8, "w": 12, "x": 12, "y": 8 }
      },
      {
        "title": "DLQ Size",
        "targets": [
          {
            "expr": "dlq_size"
          }
        ],
        "gridPos": { "h": 8, "w": 12, "x": 0, "y": 16 }
      },
      {
        "title": "HTTP Request Duration (p95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_server_request_duration_bucket[5m])) by (http_route)",
            "legendFormat": "{{http_route}}"
          }
        ],
        "gridPos": { "h": 8, "w": 12, "x": 12, "y": 16 }
      }
    ]
  }
}
```

## Structured Logging with Trace Correlation

The monitoring package now includes a structured logger that automatically
injects trace context (trace_id, span_id) into all log entries. This enables
seamless correlation between logs and traces in Grafana/Tempo/Loki.

### Log Format

All logs are output as structured JSON with the following format:

```json
{
  "@timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "message": "Processing HTTP request",
  "service": "exitbook",
  "environment": "production",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "trace_flags": "01",
  "method": "POST",
  "route": "/api/users",
  "user_agent": "Mozilla/5.0..."
}
```

### Usage Examples

```typescript
import {
  logInfo,
  logError,
  logWarning,
  logDebug,
  logWithTrace,
} from '@exitbook/platform-monitoring';

// Simple logging with automatic trace correlation
yield * logInfo('User created successfully', { userId: user.id });

// Error logging with context
yield *
  logError('Database connection failed', {
    connectionString: 'postgres://...',
    retryCount: 3,
  });

// Custom log levels
yield *
  logWithTrace('Custom operation completed', {
    operationType: 'bulk-import',
    recordsProcessed: 1500,
  });
```

### Integration with Grafana/Loki

With the structured logger in place, you can:

1. **Query logs by trace ID**:
   `{service="exitbook"} | json | trace_id="4bf92f3577b34da6a3ce929d0e0e4736"`
2. **Pivot from traces to logs**: Click on any span in Tempo to see related logs
3. **Pivot from logs to traces**: Click on trace_id in Loki to open the trace in
   Tempo
4. **Filter by log level**: `{service="exitbook"} | json | level="error"`
5. **Search by context**: `{service="exitbook"} | json | route="/api/users"`

## Monitoring Best Practices

### 1. HTTP Metrics Cardinality Management

**CRITICAL**: Always use route templates (`/users/:id`) instead of actual paths
(`/users/123`) to avoid Prometheus cardinality explosion:

```typescript
// ✅ CORRECT - Uses route template
yield * recordHttpRequest('GET', '/users/:id', 200, duration);

// ❌ WRONG - Will create unlimited unique metrics
yield * recordHttpRequest('GET', '/users/123', 200, duration);
yield * recordHttpRequest('GET', '/users/456', 200, duration);
```

The `recordHttpRequest` helper includes validation to warn about potential
cardinality issues.

### 2. Units Consistency

All latency histograms use **seconds** (OpenTelemetry semantic conventions).
Helper functions automatically convert milliseconds:

```typescript
// All these functions convert ms to seconds internally
recordHttpRequest(method, route, status, durationMs);
recordDatabaseQuery(operation, table, durationMs);
recordDurationMetric(metric, durationMs, tags);
```

Use the `msToSeconds()` utility for manual conversions:

```typescript
const durationSeconds = msToSeconds(Date.now() - started);
```

### 3. Graceful Shutdown

Always call `registerGracefulShutdown()` in your main function to ensure
telemetry data is flushed on process exit:

```typescript
import { registerGracefulShutdown } from '@exitbook/platform-monitoring';

// Register once at application startup
registerGracefulShutdown();
```

This handles:

- SIGTERM/SIGINT signals
- Uncaught exceptions
- Unhandled promise rejections
- Gives BatchSpanProcessor time to flush before exit

## Application Integration Example

```typescript name=apps/api/src/main.ts
import { Effect, Layer, Runtime } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import {
  MonitoringDefault,
  InfrastructureHealthChecks,
  HealthMonitorTag,
  recordHttpRequest,
  registerGracefulShutdown,
} from '@exitbook/platform-monitoring';
import { UnifiedEventBusDefault } from '@exitbook/platform-event-bus';
import { DatabaseDefault } from '@exitbook/platform-database';
import { MessageBusDefault } from '@exitbook/platform-messaging';

// Build the complete runtime
const AppLive = Layer.mergeAll(
  NodeRuntime.layer,
  MonitoringDefault,
  UnifiedEventBusDefault,
  DatabaseDefault,
  MessageBusDefault,
  InfrastructureHealthChecks,
);

// Example HTTP handler with monitoring and structured logging
const handleRequest = (req: Request) =>
  Effect.gen(function* () {
    const started = Date.now();
    // IMPORTANT: Use route template, not actual path to avoid cardinality explosion
    const routeTemplate = extractRouteTemplate(req.url); // "/api/users/:id" not "/api/users/123"

    // Log the incoming request with trace correlation
    yield* logInfo('Processing HTTP request', {
      method: req.method,
      route: routeTemplate,
      user_agent: req.headers.get('user-agent'),
    });

    try {
      // Your business logic here
      const result = yield* processRequest(req);

      // Record metrics with consistent units (converts ms to seconds internally)
      yield* recordHttpRequest(
        req.method,
        routeTemplate,
        200,
        Date.now() - started,
      );
      yield* logInfo('HTTP request completed successfully', {
        method: req.method,
        route: routeTemplate,
        duration_ms: Date.now() - started,
        status: 200,
      });

      return result;
    } catch (error) {
      yield* recordHttpRequest(
        req.method,
        routeTemplate,
        500,
        Date.now() - started,
      );
      yield* logError('HTTP request failed', {
        method: req.method,
        route: routeTemplate,
        duration_ms: Date.now() - started,
        status: 500,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

// Health endpoints
const healthRoutes = Effect.gen(function* () {
  const monitor = yield* HealthMonitorTag;

  return {
    '/health/live': () => monitor.getLiveness(),
    '/health/ready': () => monitor.getReadiness(),
  };
});

// Run the application with graceful shutdown
const runtime = Runtime.make(AppLive);

// Register graceful shutdown handlers for telemetry flush
registerGracefulShutdown();

Runtime.runMain(runtime)(program);
```
