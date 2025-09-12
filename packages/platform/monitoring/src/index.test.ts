import { Effect, Duration } from 'effect';
import { describe, it, expect } from 'vitest';

import type { HealthReport } from './index';
import {
  HealthMonitorTag,
  HealthMonitorLive,
  recordHttpRequest,
  recordDatabaseQuery,
} from './index';

// Type guards for response bodies
const isLivenessResponse = (
  body: unknown,
): body is {
  service: string;
  status: string;
  timestamp: string;
  version: string;
} => {
  return (
    typeof body === 'object' &&
    body !== null &&
    'service' in body &&
    'status' in body &&
    'version' in body &&
    'timestamp' in body
  );
};

const isReadinessResponse = (body: unknown): body is HealthReport => {
  return (
    typeof body === 'object' &&
    body !== null &&
    'checks' in body &&
    'status' in body &&
    'timestamp' in body
  );
};

describe('HealthMonitor', () => {
  it('should return alive status for liveness check', async () => {
    const program = Effect.gen(function* () {
      const monitor = yield* HealthMonitorTag;
      const result = yield* monitor.getLiveness();
      return result;
    });

    const result = await Effect.provide(program, HealthMonitorLive).pipe(Effect.runPromise);

    expect(result.status).toBe(200);
    if (isLivenessResponse(result.body)) {
      expect(result.body.service).toBe('exitbook');
      expect(result.body.status).toBe('alive');
      expect(result.body.version).toBe('1.0.0');
      expect(result.body).toHaveProperty('timestamp');
    } else {
      throw new Error('Invalid liveness response format');
    }
  });

  it('should return healthy status when no checks are registered', async () => {
    const program = Effect.gen(function* () {
      const monitor = yield* HealthMonitorTag;
      const result = yield* monitor.getReadiness();
      return result;
    });

    const result = await Effect.provide(program, HealthMonitorLive).pipe(Effect.runPromise);

    expect(result.status).toBe(200);
    if (isReadinessResponse(result.body)) {
      expect(result.body.checks).toEqual([]);
      expect(result.body.status).toBe('healthy');
    } else {
      throw new Error('Invalid readiness response format');
    }
  });

  it('should return healthy when all critical checks pass', async () => {
    const program = Effect.gen(function* () {
      const monitor = yield* HealthMonitorTag;

      // Register a healthy check
      yield* monitor.register({
        check: () => Effect.succeed({ status: 'healthy' as const }),
        critical: true,
        name: 'test-service',
      });

      const result = yield* monitor.getReadiness();
      return result;
    });

    const result = await Effect.provide(program, HealthMonitorLive).pipe(Effect.runPromise);

    expect(result.status).toBe(200);
    if (isReadinessResponse(result.body)) {
      expect(result.body.status).toBe('healthy');
      expect(result.body.checks).toHaveLength(1);
      expect(result.body.checks[0]).toMatchObject({
        name: 'test-service',
        status: 'healthy',
      });
    } else {
      throw new Error('Invalid readiness response format');
    }
  });

  it('should return unhealthy when any critical check fails', async () => {
    const program = Effect.gen(function* () {
      const monitor = yield* HealthMonitorTag;

      // Register a failing check
      yield* monitor.register({
        check: () =>
          Effect.succeed({
            details: { error: 'Service down' },
            status: 'unhealthy' as const,
          }),
        critical: true,
        name: 'failing-service',
      });

      const result = yield* monitor.getReadiness();
      return result;
    });

    const result = await Effect.provide(program, HealthMonitorLive).pipe(Effect.runPromise);

    expect(result.status).toBe(503);
    if (isReadinessResponse(result.body)) {
      expect(result.body.status).toBe('unhealthy');
      expect(result.body.checks[0]).toMatchObject({
        details: { error: 'Service down' },
        name: 'failing-service',
        status: 'unhealthy',
      });
    } else {
      throw new Error('Invalid readiness response format');
    }
  });

  it('should timeout health checks that take too long', async () => {
    const program = Effect.gen(function* () {
      const monitor = yield* HealthMonitorTag;

      // Register a slow check
      yield* monitor.register({
        check: () =>
          Effect.delay(Duration.millis(100))(Effect.succeed({ status: 'healthy' as const })),
        critical: true,
        name: 'slow-service',
        timeout: Duration.millis(10),
      });

      const result = yield* monitor.getReadiness();
      return result;
    });

    const result = await Effect.provide(program, HealthMonitorLive).pipe(Effect.runPromise);

    expect(result.status).toBe(503);
    if (isReadinessResponse(result.body)) {
      expect(result.body.status).toBe('unhealthy');
      expect(result.body.checks[0]).toMatchObject({
        details: { error: 'Health check timeout' },
        name: 'slow-service',
        status: 'unhealthy',
      });
    } else {
      throw new Error('Invalid readiness response format');
    }
  });
});

describe('metric helpers', () => {
  it('should create recordHttpRequest effect', () => {
    const effect = recordHttpRequest('GET', '/api/users', 200, 150);
    expect(effect).toBeDefined();
    // We can't easily test the actual metric update without a full runtime,
    // but we can verify the effect is created without error
  });

  it('should create recordDatabaseQuery effect', () => {
    const effect = recordDatabaseQuery('SELECT', 'users', 25);
    expect(effect).toBeDefined();
    // We can't easily test the actual metric update without a full runtime,
    // but we can verify the effect is created without error
  });
});
