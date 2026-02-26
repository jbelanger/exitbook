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

  it('should pass structured attempts to buildFinalError', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(err(new Error('p1 boom'))));
    const p2 = createProvider('p2', () => Promise.resolve(err(new Error('p2 boom'))));

    let capturedAttempts: import('../types.js').FailoverAttempt[] = [];
    const buildFinalError = vi.fn(
      (
        _lastError: Error | undefined,
        _attempted: string[],
        _allRecoverable: boolean,
        attempts: import('../types.js').FailoverAttempt[]
      ) => {
        capturedAttempts = attempts;
        return new Error('all failed');
      }
    );

    await executeWithFailover(baseOptions([p1, p2], { buildFinalError }));

    expect(capturedAttempts).toHaveLength(2);
    expect(capturedAttempts[0]!.providerName).toBe('p1');
    expect(capturedAttempts[0]!.error).toBe('p1 boom');
    expect(capturedAttempts[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(capturedAttempts[1]!.providerName).toBe('p2');
    expect(capturedAttempts[1]!.error).toBe('p2 boom');
  });

  it('should include blockReason for circuit-blocked providers in attempts', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(ok('data-1')));
    const p2 = createProvider('p2', () => Promise.resolve(err(new Error('p2 fail'))));
    const registry = new CircuitBreakerRegistry();

    // Open p1's circuit breaker
    registry.getOrCreate('p1');
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      registry.recordFailure('p1', now);
    }
    registry.getOrCreate('p2');

    let capturedAttempts: import('../types.js').FailoverAttempt[] = [];
    const buildFinalError = vi.fn(
      (
        _lastError: Error | undefined,
        _attempted: string[],
        _allRecoverable: boolean,
        attempts: import('../types.js').FailoverAttempt[]
      ) => {
        capturedAttempts = attempts;
        return new Error('all failed');
      }
    );

    await executeWithFailover(baseOptions([p1, p2], { circuitBreakers: registry, buildFinalError }));

    // p1 was skipped (circuit open, p2 available), p2 failed
    expect(capturedAttempts).toHaveLength(2);
    expect(capturedAttempts[0]!.providerName).toBe('p1');
    expect(capturedAttempts[0]!.blockReason).toBe('circuit_open');
    expect(capturedAttempts[1]!.providerName).toBe('p2');
    expect(capturedAttempts[1]!.error).toBe('p2 fail');
  });

  it('should include circuit transition in attempts when circuit state changes', async () => {
    const p1 = createProvider('p1', () => Promise.resolve(err(new Error('fail'))));
    const registry = new CircuitBreakerRegistry();
    registry.getOrCreate('p1');
    // Pre-load with failures so the next one trips the circuit (default maxFailures=3)
    const now = Date.now();
    registry.recordFailure('p1', now);
    registry.recordFailure('p1', now);

    let capturedAttempts: import('../types.js').FailoverAttempt[] = [];
    const buildFinalError = vi.fn(
      (
        _lastError: Error | undefined,
        _attempted: string[],
        _allRecoverable: boolean,
        attempts: import('../types.js').FailoverAttempt[]
      ) => {
        capturedAttempts = attempts;
        return new Error('all failed');
      }
    );

    await executeWithFailover(baseOptions([p1], { circuitBreakers: registry, buildFinalError }));

    expect(capturedAttempts).toHaveLength(1);
    expect(capturedAttempts[0]!.circuitTransition).toEqual({ from: 'closed', to: 'open' });
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

    expect(buildFinalError).toHaveBeenCalledWith(expect.any(RecoverableError), ['p1', 'p2'], true, expect.any(Array));
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

    expect(buildFinalError).toHaveBeenCalledWith(expect.any(Error), ['p1', 'p2'], false, expect.any(Array));
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

  describe('timeout and cancellation', () => {
    it('should abort immediately when signal is already aborted', async () => {
      const p1 = createProvider('p1', () => Promise.resolve(ok('data')));
      const controller = new AbortController();
      controller.abort(new Error('cancelled'));

      const result = await executeWithFailover(baseOptions([p1], { signal: controller.signal }));

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('cancelled');
    });

    it('should pass signal to execute callback', async () => {
      const executeSpy = vi.fn((_p: ReturnType<typeof createProvider>, _signal?: AbortSignal) =>
        Promise.resolve(ok('data'))
      );
      const p1 = createProvider('p1', () => Promise.resolve(ok('unused')));

      await executeWithFailover(
        baseOptions([p1], {
          execute: executeSpy,
          perAttemptTimeoutMs: 5000,
        })
      );

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(executeSpy.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    });

    it('should fail when per-attempt timeout expires', async () => {
      const p1 = createProvider('p1', () => new Promise((resolve) => setTimeout(() => resolve(ok('too late')), 500)));

      const result = await executeWithFailover(baseOptions([p1], { perAttemptTimeoutMs: 10 }));

      // Provider times out, treated as error, all providers exhausted
      expect(result.isErr()).toBe(true);
    });

    it('should fail when total timeout expires between attempts', async () => {
      const p1 = createProvider(
        'p1',
        () => new Promise((resolve) => setTimeout(() => resolve(err(new Error('slow'))), 50))
      );
      const p2 = createProvider('p2', () => Promise.resolve(ok('data-2')));

      const result = await executeWithFailover(baseOptions([p1, p2], { totalTimeoutMs: 10 }));

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Total timeout exceeded');
    });

    it('should not record circuit failure when caller signal aborts mid-attempt', async () => {
      const controller = new AbortController();
      const registry = new CircuitBreakerRegistry();
      registry.getOrCreate('p1');

      const p1 = createProvider('p1', () => {
        // Abort after execute starts, before it completes
        setTimeout(() => controller.abort(new Error('user cancelled')), 10);
        return new Promise((resolve) => setTimeout(() => resolve(ok('too late')), 500));
      });

      const result = await executeWithFailover(
        baseOptions([p1], { signal: controller.signal, circuitBreakers: registry })
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('user cancelled');
      // Provider was not at fault — circuit must not be penalised
      const state = registry.get('p1')!;
      expect(state.failureCount).toBe(0);
    });

    it('should record circuit failure when per-attempt timeout fires', async () => {
      const registry = new CircuitBreakerRegistry();
      registry.getOrCreate('p1');

      const p1 = createProvider('p1', () => new Promise((resolve) => setTimeout(() => resolve(ok('too late')), 500)));

      await executeWithFailover(baseOptions([p1], { perAttemptTimeoutMs: 10, circuitBreakers: registry }));

      const state = registry.get('p1')!;
      expect(state.failureCount).toBe(1);
    });

    it('should handle non-Error signal.reason without throwing', async () => {
      const p1 = createProvider('p1', () => Promise.resolve(ok('data')));
      const controller = new AbortController();
      controller.abort('string-reason'); // string, not Error

      const result = await executeWithFailover(baseOptions([p1], { signal: controller.signal }));

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('string-reason');
    });

    it('should pass timeout error to buildFinalError on total timeout expiry', async () => {
      const p1 = createProvider(
        'p1',
        () => new Promise((resolve) => setTimeout(() => resolve(err(new Error('slow'))), 2000))
      );
      const p2 = createProvider('p2', () => Promise.resolve(ok('data-2')));

      let capturedLastError: Error | undefined;
      const buildFinalError = vi.fn((lastError: Error | undefined) => {
        capturedLastError = lastError;
        return new Error('custom timeout');
      });

      await executeWithFailover(baseOptions([p1, p2], { totalTimeoutMs: 50, buildFinalError }));

      expect(buildFinalError).toHaveBeenCalled();
      expect(capturedLastError).toBeInstanceOf(Error);
      expect(capturedLastError!.message).toContain('Total timeout exceeded');
    });

    it('should not pass signal when no timeout or cancellation configured', async () => {
      const executeSpy = vi.fn((_p: ReturnType<typeof createProvider>, signal?: AbortSignal) => {
        expect(signal).toBeUndefined();
        return Promise.resolve(ok('data'));
      });
      const p1 = createProvider('p1', () => Promise.resolve(ok('unused')));

      await executeWithFailover(baseOptions([p1], { execute: executeSpy }));

      expect(executeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
