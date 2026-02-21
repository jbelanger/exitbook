/**
 * Generic one-shot failover executor
 *
 * Pure orchestrator — all state (circuit breakers, health) lives in the caller
 * and is accessed via callbacks. Follows "functional core, imperative shell":
 * the executor IS the functional core of the failover loop.
 */

import { err, ok, type Result } from 'neverthrow';

import { hasAvailableProviders, shouldBlockDueToCircuit } from '../provider-health/provider-health.js';
import type { IProvider } from '../provider-health/types.js';

import type { FailoverOptions, FailoverResult } from './types.js';

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
  } = options;

  if (providers.length === 0) {
    const finalError = buildFinalError
      ? buildFinalError(undefined, [], false)
      : (new Error(`No providers available for operation: ${operationLabel}`) as TError);
    return err(finalError);
  }

  if (providers.length > 1) {
    logger.debug(`Failover: ${providers.length} providers available for ${operationLabel}`);
  }

  let lastError: Error | undefined;
  let allRecoverable = true;
  const attemptedProviders: string[] = [];

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
      continue;
    }

    if (blockReason === 'circuit_open_no_alternatives') {
      logger.warn(`Using provider ${provider.name} despite open circuit breaker - all providers unavailable`);
    }

    if (blockReason === 'circuit_half_open') {
      logger.debug(`Testing provider ${provider.name} in half-open state`);
    }

    attemptedProviders.push(provider.name);
    const startTime = Date.now();

    try {
      const result = await execute(provider);

      if (result.isErr()) {
        throw result.error;
      }

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
    } catch (error) {
      lastError = error as Error;
      const responseTime = Date.now() - startTime;
      const recoverable = isRecoverableError(lastError);

      if (!recoverable) {
        allRecoverable = false;
      }

      logger.info(
        {
          provider: provider.name,
          totalProviders: providers.length,
          errorType: lastError.name,
        },
        `Provider ${provider.name} failed (${attemptNumber}/${providers.length}): ${lastError.message}`
      );

      // Only record circuit breaker failure for non-recoverable errors
      let newCircuitState = circuitState;
      if (!recoverable) {
        newCircuitState = circuitBreakers.recordFailure(circuitKey, Date.now());
      }

      onFailure?.(provider, lastError, responseTime, circuitState, newCircuitState);

      continue;
    }
  }

  // All providers failed
  logger.warn(
    { totalProviders: providers.length },
    `All ${attemptedProviders.length} provider(s) failed for ${operationLabel}`
  );

  const finalError = buildFinalError
    ? buildFinalError(lastError, attemptedProviders, allRecoverable)
    : (new Error(
        lastError
          ? `All ${attemptedProviders.length} provider(s) failed for ${operationLabel} (tried: ${attemptedProviders.join(', ')})`
          : `All providers failed for ${operationLabel}`
      ) as TError);

  return err(finalError);
}
