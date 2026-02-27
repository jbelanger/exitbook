/**
 * Generic one-shot failover executor
 *
 * Pure orchestrator — all state (circuit breakers, health) lives in the caller
 * and is accessed via callbacks. Follows "functional core, imperative shell":
 * the executor IS the functional core of the failover loop.
 */

import type { Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import { getCircuitStatus } from '../circuit-breaker/circuit-breaker.js';
import type { CircuitBreakerRegistry } from '../circuit-breaker/registry.js';
import type { CircuitState } from '../circuit-breaker/types.js';
import { hasAvailableProviders, shouldBlockDueToCircuit } from '../provider-health/provider-health.js';
import type { IProvider } from '../provider-health/types.js';

import type { FailoverAttempt, FailoverOptions, FailoverResult } from './types.js';

/** Coerce an unknown abort reason to Error for type-safe handoff to buildFinalError */
function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  return new Error('Operation aborted');
}

/** Record a provider failure attempt — shared by Result errors and unexpected exceptions */
function recordAttemptFailure<TProvider extends IProvider>(ctx: {
  attemptNumber: number;
  attempts: FailoverAttempt[];
  circuitBreakers: CircuitBreakerRegistry;
  circuitKey: string;
  circuitState: CircuitState;
  error: Error;
  isRecoverableError: (error: Error) => boolean;
  logger: Logger;
  now: number;
  onFailure?: FailoverOptions<TProvider, unknown>['onFailure'];
  provider: TProvider;
  startTime: number;
  totalProviders: number;
}): { recoverable: boolean } {
  const responseTime = Date.now() - ctx.startTime;
  const recoverable = ctx.isRecoverableError(ctx.error);

  ctx.logger.info(
    {
      provider: ctx.provider.name,
      totalProviders: ctx.totalProviders,
      errorType: ctx.error.name,
    },
    `Provider ${ctx.provider.name} failed (${ctx.attemptNumber}/${ctx.totalProviders}): ${ctx.error.message}`
  );

  let newCircuitState = ctx.circuitState;
  if (!recoverable) {
    newCircuitState = ctx.circuitBreakers.recordFailure(ctx.circuitKey, Date.now());
  }

  const attemptRecord: FailoverAttempt = {
    providerName: ctx.provider.name,
    durationMs: responseTime,
    error: ctx.error.message,
  };

  const prevStatus = getCircuitStatus(ctx.circuitState, ctx.now);
  const newStatus = getCircuitStatus(newCircuitState, Date.now());
  if (prevStatus !== newStatus) {
    attemptRecord.circuitTransition = { from: prevStatus, to: newStatus };
  }

  ctx.attempts.push(attemptRecord);
  ctx.onFailure?.(ctx.provider, ctx.error, responseTime, ctx.circuitState, newCircuitState);

  return { recoverable };
}

/** Race a promise against an AbortSignal — rejects with the signal's reason on abort */
function raceAgainstSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(toError(signal.reason));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(toError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * Execute an operation with automatic failover across scored providers.
 *
 * Iterates providers in order, checks circuit breakers, executes, records
 * success/failure metrics, and falls through to the next provider on failure.
 */
export async function executeWithFailover<TProvider extends IProvider, TResult, TError extends Error = Error>(
  options: FailoverOptions<TProvider, TResult, TError>
): Promise<Result<FailoverResult<TResult>, TError>> {
  const {
    providers,
    execute,
    circuitBreakers,
    operationLabel,
    logger,
    getCircuitKey = (provider) => provider.name,
    isRecoverableError = () => false,
    onSuccess,
    onFailure,
    buildFinalError,
    signal,
    perAttemptTimeoutMs,
    totalTimeoutMs,
  } = options;

  const deadline = totalTimeoutMs !== undefined ? Date.now() + totalTimeoutMs : undefined;

  if (providers.length === 0) {
    const finalError = buildFinalError
      ? buildFinalError(undefined, [], false, [])
      : (new Error(`No providers available for operation: ${operationLabel}`) as TError);
    return err(finalError);
  }

  if (providers.length > 1) {
    logger.debug(`Failover: ${providers.length} providers available for ${operationLabel}`);
  }

  let lastError: Error | undefined;
  let allRecoverable = true;
  const attemptedProviders: string[] = [];
  const attemptDiagnostics: FailoverAttempt[] = [];

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    const circuitKey = getCircuitKey(provider);
    const circuitState = circuitBreakers.getOrCreate(circuitKey);
    const attemptNumber = i + 1;
    const now = Date.now();

    // Build a circuit map for remaining providers (keyed by provider.name, looked up via circuit key)
    const remaining = providers.slice(i + 1);
    const remainingCircuitMap = new Map<string, import('../circuit-breaker/types.js').CircuitState>();
    for (const p of remaining) {
      const pCircuit = circuitBreakers.get(getCircuitKey(p));
      if (pCircuit) remainingCircuitMap.set(p.name, pCircuit);
    }
    const hasOthers = hasAvailableProviders(remaining, remainingCircuitMap, now);

    const blockReason = shouldBlockDueToCircuit(circuitState, hasOthers, now);

    if (blockReason === 'circuit_open') {
      logger.debug(`Skipping provider ${provider.name} - circuit breaker is open`);
      attemptDiagnostics.push({ providerName: provider.name, durationMs: 0, blockReason: 'circuit_open' });
      continue;
    }

    if (blockReason === 'circuit_open_no_alternatives') {
      logger.warn(`Using provider ${provider.name} despite open circuit breaker - all providers unavailable`);
    }

    if (blockReason === 'circuit_half_open') {
      logger.debug(`Testing provider ${provider.name} in half-open state`);
    }

    // Check caller cancellation before each attempt
    if (signal?.aborted) {
      const abortError = buildFinalError
        ? buildFinalError(toError(signal.reason), attemptedProviders, allRecoverable, attemptDiagnostics)
        : (toError(signal.reason) as TError);
      return err(abortError);
    }

    // Check total timeout deadline
    if (deadline !== undefined && Date.now() >= deadline) {
      const timeoutCause = new Error(
        `Total timeout exceeded for ${operationLabel} after ${attemptedProviders.length} attempt(s)`
      );
      const timeoutError = buildFinalError
        ? buildFinalError(timeoutCause, attemptedProviders, allRecoverable, attemptDiagnostics)
        : (timeoutCause as TError);
      return err(timeoutError);
    }

    attemptedProviders.push(provider.name);
    const startTime = Date.now();

    // Build per-attempt signal: combine caller signal + per-attempt timeout
    const attemptSignals: AbortSignal[] = [];
    if (signal) attemptSignals.push(signal);
    const perAttemptTimeoutSignal =
      perAttemptTimeoutMs !== undefined ? AbortSignal.timeout(perAttemptTimeoutMs) : undefined;
    if (perAttemptTimeoutSignal) attemptSignals.push(perAttemptTimeoutSignal);
    let deadlineTimeoutSignal: AbortSignal | undefined;
    if (deadline !== undefined) {
      const remainingMs = deadline - Date.now();
      deadlineTimeoutSignal = AbortSignal.timeout(Math.max(0, remainingMs));
      attemptSignals.push(deadlineTimeoutSignal);
    }

    const attemptSignal = attemptSignals.length > 0 ? AbortSignal.any(attemptSignals) : undefined;

    // Race execute against the abort signal to enforce timeouts even for non-cooperative callees
    let result: Result<TResult, Error>;
    try {
      const executePromise = execute(provider, attemptSignal);
      result = attemptSignal ? await raceAgainstSignal(executePromise, attemptSignal) : await executePromise;
    } catch (exception) {
      // Unexpected exception or timeout rejection from raceAgainstSignal.
      // Caller-initiated abort: don't penalise the provider — it may have succeeded
      // given more time. Per-attempt and deadline timeouts fall through to normal
      // failure recording because slow providers are a provider health signal.
      if (signal?.aborted) {
        const abortError = buildFinalError
          ? buildFinalError(toError(signal.reason), attemptedProviders, allRecoverable, attemptDiagnostics)
          : (toError(signal.reason) as TError);
        return err(abortError);
      }
      if (deadlineTimeoutSignal?.aborted) {
        const timeoutCause = new Error(
          `Total timeout exceeded for ${operationLabel} after ${attemptedProviders.length} attempt(s)`
        );
        const timeoutError = buildFinalError
          ? buildFinalError(timeoutCause, attemptedProviders, allRecoverable, attemptDiagnostics)
          : (timeoutCause as TError);
        return err(timeoutError);
      }

      lastError = exception instanceof Error ? exception : new Error(String(exception));
      const { recoverable } = recordAttemptFailure({
        error: lastError,
        provider,
        startTime,
        circuitKey,
        circuitState,
        now,
        attemptNumber,
        attempts: attemptDiagnostics,
        circuitBreakers,
        isRecoverableError,
        logger,
        totalProviders: providers.length,
        onFailure,
      });
      if (!recoverable) allRecoverable = false;
      continue;
    }

    // Result-based error path — type-safe, no cast needed
    if (result.isErr()) {
      lastError = result.error;
      const { recoverable } = recordAttemptFailure({
        error: lastError,
        provider,
        startTime,
        circuitKey,
        circuitState,
        now,
        attemptNumber,
        attempts: attemptDiagnostics,
        circuitBreakers,
        isRecoverableError,
        logger,
        totalProviders: providers.length,
        onFailure,
      });
      if (!recoverable) allRecoverable = false;
      continue;
    }

    // Success path
    const responseTime = Date.now() - startTime;
    circuitBreakers.recordSuccess(circuitKey, Date.now());

    logger.debug(
      {
        provider: provider.name,
        responseTime,
        attemptNumber,
        totalProviders: providers.length,
      },
      `Provider ${provider.name} succeeded (${attemptNumber}/${providers.length})`
    );

    onSuccess?.(provider, responseTime);

    return ok({ data: result.value, providerName: provider.name });
  }

  // All providers failed
  logger.warn(
    { totalProviders: providers.length },
    `All ${attemptedProviders.length} provider(s) failed for ${operationLabel}`
  );

  const finalError = buildFinalError
    ? buildFinalError(lastError, attemptedProviders, allRecoverable, attemptDiagnostics)
    : (new Error(
        lastError
          ? `All ${attemptedProviders.length} provider(s) failed for ${operationLabel} (tried: ${attemptedProviders.join(', ')})`
          : `All providers failed for ${operationLabel}`
      ) as TError);

  return err(finalError);
}
