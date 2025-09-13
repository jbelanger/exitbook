import { Layer, Effect, Duration, Ref, Chunk, Context } from 'effect';

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

export const HealthMonitorTag = Context.GenericTag<HealthMonitor>(
  '@exitbook/platform-monitoring/HealthMonitor',
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
