// Pure utility functions for benchmark-rate-limit command
// All functions are pure - no side effects

import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

/**
 * CLI options structure for benchmark-rate-limit command.
 */
export interface BenchmarkRateLimitCommandOptions {
  blockchain: string;
  provider: string;
  maxRate?: string | undefined;
  rates?: string | undefined;
  numRequests?: string | undefined;
  skipBurst?: boolean | undefined;
}

/**
 * Parsed benchmark parameters.
 */
export interface BenchmarkParams {
  blockchain: string;
  provider: string;
  maxRate: number;
  numRequests: number;
  skipBurst: boolean;
  customRates?: number[] | undefined;
}

/**
 * Parse and validate max rate parameter.
 */
export function parseMaxRate(maxRate?: string): Result<number, Error> {
  const value = maxRate || '5';
  const parsed = parseFloat(value);

  if (isNaN(parsed) || parsed <= 0) {
    return err(new Error(`Invalid max-rate value: "${value}". Must be a positive number.`));
  }

  return ok(parsed);
}

/**
 * Parse and validate num requests parameter.
 */
export function parseNumRequests(numRequests?: string): Result<number, Error> {
  const value = numRequests || '10';
  const parsed = parseInt(value, 10);

  if (isNaN(parsed) || parsed <= 0) {
    return err(new Error(`Invalid num-requests value: "${value}". Must be a positive integer.`));
  }

  return ok(parsed);
}

/**
 * Parse and validate custom rates list.
 */
export function parseCustomRates(rates?: string): Result<number[] | undefined, Error> {
  if (!rates) {
    return ok(undefined);
  }

  const parsed = rates.split(',').map((r) => parseFloat(r.trim()));

  if (parsed.some((r) => isNaN(r) || r <= 0)) {
    return err(new Error(`Invalid rates: "${rates}". All values must be positive numbers.`));
  }

  return ok(parsed);
}

/**
 * Build benchmark parameters from command options.
 * Validates all parameters and returns a Result.
 */
export function buildBenchmarkParams(options: BenchmarkRateLimitCommandOptions): Result<BenchmarkParams, Error> {
  // Validate blockchain and provider are provided
  if (!options.blockchain || options.blockchain.trim() === '') {
    return err(new Error('Blockchain is required'));
  }

  if (!options.provider || options.provider.trim() === '') {
    return err(new Error('Provider is required'));
  }

  // Parse max rate
  const maxRateResult = parseMaxRate(options.maxRate);
  if (maxRateResult.isErr()) {
    return err(maxRateResult.error);
  }

  // Parse num requests
  const numRequestsResult = parseNumRequests(options.numRequests);
  if (numRequestsResult.isErr()) {
    return err(numRequestsResult.error);
  }

  // Parse custom rates
  const customRatesResult = parseCustomRates(options.rates);
  if (customRatesResult.isErr()) {
    return err(customRatesResult.error);
  }

  return ok({
    blockchain: options.blockchain.trim(),
    provider: options.provider.trim(),
    maxRate: maxRateResult.value,
    numRequests: numRequestsResult.value,
    skipBurst: options.skipBurst || false,
    customRates: customRatesResult.value,
  });
}

/**
 * Format rate limit configuration for display.
 */
export function formatRateLimit(rateLimit: { burstLimit?: number; requestsPerSecond: number }): string {
  if (rateLimit.burstLimit) {
    return `${rateLimit.requestsPerSecond} req/sec, burst: ${rateLimit.burstLimit}`;
  }
  return `${rateLimit.requestsPerSecond} req/sec`;
}

type ConfigOverride = Record<
  string,
  {
    overrides: Record<
      string,
      {
        rateLimit: {
          burstLimit?: number | undefined;
          requestsPerSecond: number;
        };
      }
    >;
  }
>;

export function buildConfigOverride(
  blockchain: string,
  provider: string,
  recommended: { burstLimit?: number | undefined; requestsPerSecond: number }
): ConfigOverride {
  return {
    [blockchain]: {
      overrides: {
        [provider]: {
          rateLimit: recommended,
        },
      },
    },
  };
}
