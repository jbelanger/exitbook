import { trace, SpanKind } from '@opentelemetry/api';
import { Effect, pipe, Metric, MetricBoundaries, Layer } from 'effect';

import { EventStoreTag, type EventStore } from './port';

// EventStore Metrics
export const EventStoreMetrics = {
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
};

// Type guard for objects with events array
const hasEventsArray = (obj: unknown): obj is { events: unknown[] } => {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'events' in obj &&
    Array.isArray((obj as Record<string, unknown>)['events'])
  );
};

export const createMonitoredEventStore = <T extends EventStore>(
  eventStore: T,
  serviceName = '@exitbook/event-store',
  serviceVersion = '1.0.0',
): T => {
  const tracer = trace.getTracer(serviceName, serviceVersion);

  // Helper to wrap methods with monitoring
  const wrapWithMonitoring =
    <Args extends unknown[], Return>(
      methodName: string,
      originalMethod: (...args: Args) => Effect.Effect<Return, unknown, unknown>,
      operation: string,
    ) =>
    (...args: Args) =>
      pipe(
        Effect.Do,
        Effect.bind('span', () =>
          Effect.sync(() =>
            tracer.startSpan(`eventstore.${methodName}`, {
              attributes: {
                'db.operation': operation,
                'db.system': 'eventstore',
                ...(args[0] && typeof args[0] === 'string' ? { 'eventstore.stream': args[0] } : {}),
              },
              kind: SpanKind.CLIENT,
            }),
          ),
        ),
        Effect.bind('started', () => Effect.sync(() => Date.now())),
        Effect.bind('result', ({ span }) =>
          originalMethod(...args).pipe(
            Effect.tapBoth({
              onFailure: (e) =>
                Effect.sync(() => {
                  span.recordException(e instanceof Error ? e : new Error(String(e)));
                  span.setStatus({ code: 2 });
                }),
              onSuccess: () => Effect.sync(() => span.setStatus({ code: 1 })),
            }),
          ),
        ),
        Effect.tap(({ span, started }) =>
          Effect.sync(() => {
            const duration = (Date.now() - started) / 1000;

            // Record metrics based on operation
            switch (operation) {
              case 'append':
                Metric.update(EventStoreMetrics.eventstoreAppendDuration, duration);
                if (hasEventsArray(args[1])) {
                  Metric.update(EventStoreMetrics.eventstoreEventsAppended, args[1].events.length);
                }
                break;
              case 'read':
                Metric.update(EventStoreMetrics.eventstoreReadDuration, duration);
                break;
            }

            span.end();
          }),
        ),
        Effect.map(({ result }) => result),
      );

  // Create a proxy to wrap methods automatically
  return new Proxy(eventStore, {
    get(target, prop) {
      const value = target[prop as keyof T];

      if (typeof value === 'function') {
        const methodName = String(prop);

        // Map method names to operations
        const operationMap: Record<string, string> = {
          appendAndReturn: 'append',
          readAll: 'readAll',
          readCategory: 'readCategory',
          readStream: 'read',
        };

        const operation = operationMap[methodName];

        if (operation) {
          // Type assertion is safe here because we've checked that value is a function
          const method = value as (...args: unknown[]) => Effect.Effect<unknown, unknown, unknown>;
          return wrapWithMonitoring(methodName, method.bind(target), operation);
        }
      }

      return value;
    },
  });
};

// Layer that wraps EventStore with monitoring
export const MonitoredEventStoreLive = Layer.effect(
  EventStoreTag,
  Effect.gen(function* () {
    const store = yield* EventStoreTag;
    return createMonitoredEventStore(store);
  }),
);
