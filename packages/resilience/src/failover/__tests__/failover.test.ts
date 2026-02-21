/**
 * Tests for the generic failover executor
 * Pure function tests — mocks only for side-effect callbacks
 */

import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { CircuitBreakerRegistry } from '../../circuit-breaker/registry.js';
import type { IProvider } from '../../provider-health/types.js';
import { executeWithFailover } from '../failover.js';
import type { FailoverOptions } from '../types.js';

// Stub provider factory
function createProvider(
  name: string,
  result: () => Promise<Result<string, Error>>
): IProvider & { exec: typeof result } {
  return {
    name,
    exec: result,
  };
}

// Minimal logger stub
function createLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function baseOptions(
  providers: ReturnType<typeof createProvider>[],
  overrides?: Partial<FailoverOptions<ReturnType<typeof createProvider>, string, Error>>
): FailoverOptions<ReturnType<typeof createProvider>, string, Error> {
  return {
    providers,
    execute: (p) => p.exec(),
    circuitBreakers: new CircuitBreakerRegistry(),
    operationLabel: 'test-op',
    logger: createLogger(),
    ...overrides,
  };
}

describe('executeWithFailover', () => {
  it('should succeed with first provider', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(ok('data-1')));
    const result = await executeWithFailover(baseOptions([p1]));

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ data: 'data-1', providerName: 'p1' });
  });

  it('should failover when first provider fails', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(err(new Error('p1 failed'))));
    const p2 = createProvider('p2', () => Promise.resolve(ok('data-2')));
    const result = await executeWithFailover(baseOptions([p1, p2]));

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ data: 'data-2', providerName: 'p2' });
  });

  it('should return error when all providers fail', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(err(new Error('p1 failed'))));
    const p2 = createProvider('p2', () => Promise.resolve(err(new Error('p2 failed'))));
    const result = await executeWithFailover(baseOptions([p1, p2]));

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('p1, p2');
  });

  it('should return error when no providers available', async () => {
    const result = await executeWithFailover(baseOptions([]));

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('No providers available');
  });

  it('should skip provider with open circuit when alternatives exist', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(ok('data-1')));
    const p2 = createProvider('p2', () => Promise.resolve(ok('data-2')));
    const registry = new CircuitBreakerRegistry();

    // Open p1's circuit breaker
    registry.getOrCreate('p1');
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      registry.recordFailure('p1', now);
    }
    registry.getOrCreate('p2');

    const result = await executeWithFailover(baseOptions([p1, p2], { circuitBreakers: registry }));

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().providerName).toBe('p2');
  });

  it('should use provider with open circuit when no alternatives', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(ok('data-1')));
    const registry = new CircuitBreakerRegistry();

    // Open p1's circuit breaker
    registry.getOrCreate('p1');
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      registry.recordFailure('p1', now);
    }

    const logger = createLogger();
    const result = await executeWithFailover(baseOptions([p1], { circuitBreakers: registry, logger }));

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().providerName).toBe('p1');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('despite open circuit breaker'));
  });

  it('should not record circuit failure for recoverable errors', async () => {
    class RecoverableError extends Error {
      constructor() {
        super('recoverable');
        this.name = 'RecoverableError';
      }
    }

    const p1 = createProvider('p1', () => Promise.resolve(err(new RecoverableError())));
    const registry = new CircuitBreakerRegistry();
    registry.getOrCreate('p1');

    await executeWithFailover(
      baseOptions([p1], {
        circuitBreakers: registry,
        isRecoverableError: (e) => e instanceof RecoverableError,
      })
    );

    // Circuit should still be closed (no failures recorded)
    const state = registry.get('p1')!;
    expect(state.failureCount).toBe(0);
  });

  it('should record circuit failure for non-recoverable errors', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(err(new Error('hard fail'))));
    const registry = new CircuitBreakerRegistry();
    registry.getOrCreate('p1');

    await executeWithFailover(baseOptions([p1], { circuitBreakers: registry }));

    const state = registry.get('p1')!;
    expect(state.failureCount).toBe(1);
  });

  it('should use custom circuit key', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(ok('data-1')));
    const registry = new CircuitBreakerRegistry();
    registry.getOrCreate('custom/p1');

    const result = await executeWithFailover(
      baseOptions([p1], {
        circuitBreakers: registry,
        getCircuitKey: (provider) => `custom/${provider.name}`,
      })
    );

    expect(result.isOk()).toBe(true);
    // Verify success was recorded under the custom key
    const state = registry.get('custom/p1')!;
    expect(state.lastSuccessTime).toBeGreaterThan(0);
  });

  it('should invoke onSuccess callback with correct args', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(ok('data-1')));
    const onSuccess = vi.fn();

    await executeWithFailover(baseOptions([p1], { onSuccess }));

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ name: 'p1' }), expect.any(Number));
  });

  it('should invoke onFailure callback with previous and new circuit state', async () => {
    const error = new Error('test failure');
    const p1 = createProvider('p1', () => Promise.resolve(err(error)));
    const onFailure = vi.fn();

    await executeWithFailover(baseOptions([p1], { onFailure }));

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'p1' }),
      error,
      expect.any(Number),
      expect.objectContaining({ failureCount: 0 }), // previous state
      expect.objectContaining({ failureCount: 1 }) // new state
    );
  });

  it('should use custom buildFinalError', async () => {
    class CustomError extends Error {
      constructor(public readonly code: string) {
        super('custom');
        this.name = 'CustomError';
      }
    }

    const p1 = createProvider('p1', () => Promise.resolve(err(new Error('fail'))));

    const result = await executeWithFailover<ReturnType<typeof createProvider>, string, CustomError>(
      baseOptions([p1], {
        buildFinalError: (_lastError, attempted) => new CustomError(`ALL_FAILED:${attempted.join(',')}`),
      }) as FailoverOptions<ReturnType<typeof createProvider>, string, CustomError>
    );

    expect(result.isErr()).toBe(true);
    const resultError = result._unsafeUnwrapErr();
    expect(resultError).toBeInstanceOf(CustomError);
    expect(resultError.code).toBe('ALL_FAILED:p1');
  });

  it('should track allRecoverable correctly in buildFinalError', async () => {
    class RecoverableError extends Error {}

    const p1 = createProvider('p1', () => Promise.resolve(err(new RecoverableError('r1'))));
    const p2 = createProvider('p2', () => Promise.resolve(err(new RecoverableError('r2'))));
    const buildFinalError = vi.fn(
      (_lastError: Error | undefined, _attempted: string[], allRecoverable: boolean) =>
        new Error(`all=${allRecoverable}`)
    );

    await executeWithFailover(
      baseOptions([p1, p2], {
        isRecoverableError: (e) => e instanceof RecoverableError,
        buildFinalError,
      })
    );

    expect(buildFinalError).toHaveBeenCalledWith(expect.any(RecoverableError), ['p1', 'p2'], true);
  });

  it('should set allRecoverable to false when mixed errors occur', async () => {
    class RecoverableError extends Error {}

    const p1 = createProvider('p1', () => Promise.resolve(err(new RecoverableError('r1'))));
    const p2 = createProvider('p2', () => Promise.resolve(err(new Error('hard'))));
    const buildFinalError = vi.fn(
      (_lastError: Error | undefined, _attempted: string[], allRecoverable: boolean) =>
        new Error(`all=${allRecoverable}`)
    );

    await executeWithFailover(
      baseOptions([p1, p2], {
        isRecoverableError: (e) => e instanceof RecoverableError,
        buildFinalError,
      })
    );

    expect(buildFinalError).toHaveBeenCalledWith(expect.any(Error), ['p1', 'p2'], false);
  });

  it('should record circuit success on provider success', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(ok('data')));
    const registry = new CircuitBreakerRegistry();
    registry.getOrCreate('p1');

    await executeWithFailover(baseOptions([p1], { circuitBreakers: registry }));

    const state = registry.get('p1')!;
    expect(state.failureCount).toBe(0);
    expect(state.lastSuccessTime).toBeGreaterThan(0);
  });
});
