import { Effect, Layer, Duration } from 'effect';

import { HealthMonitorTag } from './index';

// Infrastructure Health Checks Layer
// This layer can be composed with your application to register standard infrastructure checks
export const InfrastructureHealthChecks = Layer.effect(
  HealthMonitorTag,
  Effect.gen(function* () {
    const monitor = yield* HealthMonitorTag;

    // Memory check - this is safe and doesn't require external dependencies
    yield* monitor.register({
      check: () =>
        Effect.sync(() => {
          const memUsage = process.memoryUsage();
          const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
          const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

          // Consider unhealthy if using more than 1GB heap
          const isHealthy = heapUsedMB < 1024;

          return {
            details: {
              heapTotalMB,
              heapUsedMB,
              rssMB: Math.round(memUsage.rss / 1024 / 1024),
            },
            status: isHealthy ? ('healthy' as const) : ('unhealthy' as const),
          };
        }),
      critical: false,
      name: 'memory',
      timeout: Duration.seconds(1),
    });

    return monitor;
  }),
);

// Helper to create database health checks
export const createDatabaseHealthCheck = (
  name: string,
  checkQuery: () => Effect.Effect<unknown, unknown, never>,
) => ({
  check: () =>
    checkQuery().pipe(
      Effect.map(() => ({ status: 'healthy' as const })),
      Effect.catchAll((error) =>
        Effect.succeed({
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
          status: 'unhealthy' as const,
        }),
      ),
    ),
  critical: true,
  name,
  timeout: Duration.seconds(5),
});

// Helper to create message broker health checks
export const createMessageBrokerHealthCheck = (
  name: string,
  healthCheck: () => Effect.Effect<boolean, unknown, never>,
) => ({
  check: () =>
    healthCheck().pipe(
      Effect.map((isHealthy) => ({
        status: isHealthy ? ('healthy' as const) : ('unhealthy' as const),
      })),
      Effect.catchAll((error) =>
        Effect.succeed({
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
          status: 'unhealthy' as const,
        }),
      ),
    ),
  critical: true,
  name,
  timeout: Duration.seconds(5),
});
