/**
 * Standalone rate limit benchmark tool.
 *
 * Extracted from BaseApiClient to keep the IBlockchainProvider interface clean.
 * Accepts a health check function so the caller controls HTTP client configuration
 * (e.g. bypassing the provider's rate limiter during benchmarking).
 */

import type { RateLimitConfig } from '@exitbook/http';
import { RateLimitError } from '@exitbook/http';
import type { Logger } from '@exitbook/logger';
import type { Result } from 'neverthrow';

/**
 * Progress events emitted during rate limit benchmarking.
 * Passed via optional `onProgress` callback for live TUI updates.
 */
export type BenchmarkProgressEvent =
  | { rate: number; type: 'sustained-start' }
  | { rate: number; responseTimeMs?: number | undefined; success: boolean; type: 'sustained-complete' }
  | { limit: number; type: 'burst-start' }
  | { limit: number; success: boolean; type: 'burst-complete' };

export interface BenchmarkResult {
  burstLimits?: { limit: number; success: boolean }[] | undefined;
  maxSafeRate: number;
  recommended: RateLimitConfig;
  testResults: { rate: number; responseTimeMs?: number | undefined; success: boolean }[];
}

// Number of concurrent requests per batch when testing burst rate limits.
// Balances speed of detection with avoiding overwhelming the API endpoint.
const BURST_BENCHMARK_BATCH_SIZE = 5;

/**
 * Benchmark an API to find optimal rate limits.
 * Tests both sustained per-second rates and per-minute burst limits.
 *
 * @param checkHealth - Function that sends a single health-check request and returns success/failure.
 *   The caller is responsible for creating this with an appropriate HTTP client
 *   (typically one with permissive rate limits and short timeouts).
 * @param logger - Logger instance for benchmark output
 * @param providerDisplayName - Display name for log messages
 * @param maxRequestsPerSecond - Maximum sustained rate to test (default: 5)
 * @param numRequestsPerTest - Number of requests per rate test (default: 10)
 * @param testBurstLimits - Whether to test per-minute burst limits (default: true)
 * @param customRates - Optional custom rates to test instead of default progression
 * @param onProgress - Optional callback for live progress updates
 */
export async function benchmarkRateLimit(options: {
  checkHealth: () => Promise<Result<boolean, Error>>;
  customRates?: number[] | undefined;
  logger: Logger;
  maxRequestsPerSecond?: number | undefined;
  numRequestsPerTest?: number | undefined;
  onProgress?: ((event: BenchmarkProgressEvent) => void) | undefined;
  providerDisplayName: string;
  testBurstLimits?: boolean | undefined;
}): Promise<BenchmarkResult> {
  const {
    checkHealth,
    customRates,
    logger,
    maxRequestsPerSecond = 5,
    numRequestsPerTest = 10,
    onProgress,
    providerDisplayName,
    testBurstLimits = true,
  } = options;

  logger.info(`Starting rate limit benchmark for ${providerDisplayName}`);

  const testResults: { rate: number; responseTimeMs?: number | undefined; success: boolean }[] = [];
  let maxSafeRate = 0.25; // Start conservative
  let baselineResponseTime: number | undefined;
  let totalRequests = 0;
  const benchmarkStartTime = Date.now();

  // Test sustained per-second rates
  logger.info('Starting sustained rate tests...');
  const ratesToTest = customRates
    ? customRates.sort((a, b) => a - b)
    : [0.25, 0.5, 1.0, 2.5, 5.0, maxRequestsPerSecond].filter((r) => r <= maxRequestsPerSecond);

  for (const rate of ratesToTest) {
    onProgress?.({ type: 'sustained-start', rate });

    const rateTestStartTime = Date.now();
    const elapsedMinutes = (rateTestStartTime - benchmarkStartTime) / 60000;

    logger.info(
      `Testing rate: ${rate} req/sec - Total requests so far: ${totalRequests}, Elapsed: ${elapsedMinutes.toFixed(1)}min`
    );

    const delayMs = Math.floor(1000 / rate);
    let success = true;
    const responseTimes: number[] = [];
    let hadTimeout = false;
    let failedOnRequestNumber: number | undefined;

    for (let i = 0; i < numRequestsPerTest; i++) {
      totalRequests++;
      const start = Date.now();
      const result = await checkHealth();

      if (result.isErr()) {
        if (result.error instanceof RateLimitError) {
          logger.warn(
            `Hit explicit 429 rate limit at ${rate} req/sec on request #${i + 1}/${numRequestsPerTest} (total: ${totalRequests})`
          );
          failedOnRequestNumber = i + 1;
          success = false;
          break;
        }
        if (result.error.message.includes('timeout')) {
          logger.warn(
            `Request timeout at ${rate} req/sec on request #${i + 1}/${numRequestsPerTest} (total: ${totalRequests}) - possible soft rate limiting`
          );
          failedOnRequestNumber = i + 1;
          hadTimeout = true;
        } else {
          throw result.error;
        }
      } else {
        if (!result.value) {
          throw new Error('Health check returned false');
        }
        const responseTime = Date.now() - start;
        responseTimes.push(responseTime);
      }

      if (i < numRequestsPerTest - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const rateTestDuration = Date.now() - rateTestStartTime;
    logger.debug(`Rate test completed in ${(rateTestDuration / 1000).toFixed(1)}s`);

    const avgResponseTime =
      responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : undefined;

    if (!baselineResponseTime && avgResponseTime) {
      baselineResponseTime = avgResponseTime;
      logger.debug(`Baseline response time established: ${baselineResponseTime.toFixed(0)}ms`);
    }

    // Detect soft rate limiting: response time increased significantly or had timeouts
    if (avgResponseTime && baselineResponseTime) {
      const slowdownFactor = avgResponseTime / baselineResponseTime;
      if (slowdownFactor > 3 || hadTimeout) {
        logger.warn(
          `Soft rate limiting detected at ${rate} req/sec - Response time: ${avgResponseTime.toFixed(0)}ms (${slowdownFactor.toFixed(1)}x slower than baseline), Timeouts: ${hadTimeout}, Failed on request: ${failedOnRequestNumber || 'N/A'}`
        );
        success = false;
      }
    }

    testResults.push({
      rate,
      ...(avgResponseTime !== undefined && { responseTimeMs: avgResponseTime }),
      success,
    });

    onProgress?.({ type: 'sustained-complete', rate, success, responseTimeMs: avgResponseTime });

    if (success) {
      maxSafeRate = rate;
      logger.info(`Rate ${rate} req/sec succeeded - AvgResponseTime: ${avgResponseTime?.toFixed(0)}ms`);
    } else {
      const elapsedSinceStart = (Date.now() - benchmarkStartTime) / 1000;
      logger.warn(
        `Rate ${rate} req/sec failed - Failed on request #${failedOnRequestNumber || 'unknown'}, Total requests: ${totalRequests}, Time since start: ${elapsedSinceStart.toFixed(1)}s`
      );

      if (failedOnRequestNumber && totalRequests >= 10) {
        const avgRequestsPerMinute = (totalRequests / (elapsedSinceStart / 60)).toFixed(1);
        logger.info(
          `Average rate so far: ${avgRequestsPerMinute} req/min. If this is close to a round number (10, 15, 20, 30, 60), the API may have a per-minute limit.`
        );
      }

      break;
    }

    // Pause between rate tests to let sliding windows clear
    logger.debug('Waiting 60 seconds before next rate test to clear any sliding windows...');
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }

  // Test per-minute burst limits
  let burstLimits: { limit: number; success: boolean }[] | undefined;
  let maxSafeBurstPerMinute: number | undefined;

  if (testBurstLimits) {
    logger.info('Starting per-minute burst limit tests...');
    burstLimits = [];

    const burstLimitsToTest = [10, 15, 20, 30, 60];

    for (const burstLimit of burstLimitsToTest) {
      onProgress?.({ type: 'burst-start', limit: burstLimit });

      logger.info(`Testing burst: ${burstLimit} requests/minute (sending rapidly)`);

      const burstStartTime = Date.now();
      let burstSuccess = true;
      const burstResponseTimes: number[] = [];
      let failedOnRequest: number | undefined;

      for (let batch = 0; batch < Math.ceil(burstLimit / BURST_BENCHMARK_BATCH_SIZE); batch++) {
        const batchStart = batch * BURST_BENCHMARK_BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BURST_BENCHMARK_BATCH_SIZE, burstLimit);
        const batchPromises: Promise<number>[] = [];

        for (let i = batchStart; i < batchEnd; i++) {
          const promise = (async () => {
            const start = Date.now();
            const result = await checkHealth();

            if (result.isErr()) {
              if (result.error instanceof RateLimitError) {
                failedOnRequest = i + 1;
                throw result.error;
              }
              failedOnRequest = i + 1;
              throw result.error;
            }

            if (!result.value) {
              throw new Error('Health check returned false');
            }

            return Date.now() - start;
          })();
          batchPromises.push(promise);
        }

        try {
          const batchResults = await Promise.all(batchPromises);
          burstResponseTimes.push(...batchResults);
        } catch (error) {
          if (error instanceof RateLimitError || (error instanceof Error && error.message.includes('timeout'))) {
            logger.warn(`Burst limit hit at ${burstLimit} req/min on request #${failedOnRequest}/${burstLimit}`);
            burstSuccess = false;
            break;
          }
          throw error;
        }

        // Small delay between batches to avoid overwhelming connection pool
        if (batch < Math.ceil(burstLimit / BURST_BENCHMARK_BATCH_SIZE) - 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      const burstDuration = (Date.now() - burstStartTime) / 1000;
      const avgBurstResponseTime =
        burstResponseTimes.length > 0
          ? burstResponseTimes.reduce((a, b) => a + b, 0) / burstResponseTimes.length
          : undefined;
      const actualRate = burstResponseTimes.length / burstDuration;

      burstLimits.push({ limit: burstLimit, success: burstSuccess });

      onProgress?.({ type: 'burst-complete', limit: burstLimit, success: burstSuccess });

      if (burstSuccess) {
        maxSafeBurstPerMinute = burstLimit;
        logger.info(
          `Burst ${burstLimit} req/min succeeded - Completed ${burstResponseTimes.length} requests in ${burstDuration.toFixed(1)}s (${actualRate.toFixed(1)} req/sec actual), AvgResponseTime: ${avgBurstResponseTime?.toFixed(0)}ms`
        );
      } else {
        logger.warn(
          `Burst ${burstLimit} req/min failed - ${burstResponseTimes.length} requests completed in ${burstDuration.toFixed(1)}s before hitting limit`
        );
        break;
      }

      logger.debug('Waiting 60 seconds before next burst test...');
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }

    if (maxSafeBurstPerMinute) {
      logger.info(`Max safe burst detected: ${maxSafeBurstPerMinute} requests/minute`);
    }
  }

  // Calculate recommended config with 80% safety margin
  const safeRate = maxSafeRate * 0.8;
  const recommended: RateLimitConfig = {
    burstLimit: Math.max(3, Math.ceil(safeRate * 2)),
    requestsPerHour: Math.floor(safeRate * 3600 * 0.9),
    requestsPerMinute: maxSafeBurstPerMinute
      ? Math.floor(maxSafeBurstPerMinute * 0.8)
      : Math.floor(safeRate * 60 * 0.9),
    requestsPerSecond: Math.round(safeRate * 100) / 100,
  };

  logger.info(`Benchmark complete - MaxSafeRate: ${maxSafeRate} req/sec, Recommended: ${JSON.stringify(recommended)}`);

  return {
    ...(burstLimits && { burstLimits }),
    maxSafeRate,
    recommended,
    testResults,
  };
}
