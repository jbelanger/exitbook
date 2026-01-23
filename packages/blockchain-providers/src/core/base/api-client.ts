import type { CursorState, PaginationCursor } from '@exitbook/core';
import type { RateLimitConfig } from '@exitbook/http';
import { HttpClient } from '@exitbook/http';
import { RateLimitError } from '@exitbook/http';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';
import { err, errAsync, ok, type Result } from 'neverthrow';

import { ProviderRegistry } from '../registry/provider-registry.js';
import type { NormalizedTransactionBase } from '../schemas/normalized-transaction.ts';
import { createStreamingIterator, type StreamingAdapterOptions } from '../streaming/streaming-adapter.js';
import type {
  IBlockchainProvider,
  OneShotOperation,
  ProviderCapabilities,
  ProviderConfig,
  ProviderMetadata,
  StreamingBatchResult,
  StreamingOperation,
} from '../types/index.js';

// Burst benchmark batch size: Number of concurrent requests to send when testing burst rate limits
// Set at 5 to balance speed of detection with avoiding overwhelming the API endpoint
const BURST_BENCHMARK_BATCH_SIZE = 5;

/**
 * Abstract base class for registry-based providers
 * Handles all common provider functionality using registry metadata
 */
export abstract class BaseApiClient implements IBlockchainProvider {
  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly config: ProviderConfig;
  protected httpClient: HttpClient;
  protected readonly logger: Logger;
  protected readonly metadata: ProviderMetadata;

  constructor(config: ProviderConfig) {
    this.config = config;

    // Get metadata from registry
    const metadata = ProviderRegistry.getMetadata(config.blockchain, config.name);
    if (!metadata) {
      const availableProviders = ProviderRegistry.getAvailable(config.blockchain).map((p) => p.name);
      const availableProvidersList = availableProviders.length > 0 ? availableProviders.join(', ') : 'none';
      const registryLogger = getLogger('provider-registry');

      registryLogger.warn(
        {
          availableProviders,
          blockchain: config.blockchain,
          providerName: config.name,
        },
        `Provider not found in registry for blockchain '${config.blockchain}' and provider '${config.name}'. Available providers: ${availableProvidersList}.`
      );

      registryLogger.info(
        `HINT: Run 'pnpm run providers:list --blockchain ${config.blockchain}' to see all options. ` +
          `HINT: Check for typos in provider name '${config.name}'. ` +
          `HINT: Use 'pnpm run providers:sync --fix' to sync configuration.`
      );

      throw new Error(`Provider '${config.name}' not found in registry for blockchain '${config.blockchain}'.`);
    }
    this.metadata = metadata;

    this.logger = getLogger(`${this.metadata.displayName.replace(/\s+/g, '')}`);

    // Use config values (which may override metadata defaults)
    this.baseUrl = config.baseUrl;

    // Get API key from environment if required
    this.apiKey = this.getApiKey();

    // Initialize HTTP client
    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      instrumentation: config.instrumentation,
      providerName: this.metadata.name,
      rateLimit: config.rateLimit,
      retries: config.retries,
      service: 'blockchain',
      timeout: config.timeout,
    });

    this.logger.debug(
      `Initialized ${this.metadata.displayName} for ${config.blockchain} - BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
  }

  get blockchain(): string {
    return this.config.blockchain;
  }

  get capabilities(): ProviderCapabilities {
    return this.metadata.capabilities;
  }

  abstract execute<T>(operation: OneShotOperation): Promise<Result<T, Error>>;

  /**
   * Provide health check configuration for this provider
   * Derived classes must specify endpoint, validation logic, and optionally POST details
   */
  abstract getHealthCheckConfig(): {
    body?: unknown;
    endpoint: string;
    method?: 'GET' | 'POST';
    validate: (response: unknown) => boolean;
  };

  /**
   * Execute operation with streaming pagination
   * Default implementation throws error - providers should implement when ready for Phase 1+
   */
  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    _operation: StreamingOperation,
    _cursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    yield errAsync(
      new Error(`Streaming pagination not yet implemented for ${this.name}. Use execute() method instead.`)
    );
  }

  /**
   * Extract all available cursor types from a transaction
   * Default implementation returns empty array - providers should implement when ready for Phase 1+
   */
  extractCursors(_transaction: unknown): PaginationCursor[] {
    return [];
  }

  /**
   * Apply replay window to a cursor for safe failover
   * Default implementation returns cursor unchanged - providers should implement when ready for Phase 1+
   */
  applyReplayWindow(cursor: PaginationCursor): PaginationCursor {
    return cursor;
  }

  /**
   * Check if the provider's API is healthy and responding correctly
   * Returns Result to allow special handling of RateLimitError in benchmarks
   */
  async isHealthy(): Promise<Result<boolean, Error>> {
    const config = this.getHealthCheckConfig();
    const method = config.method || 'GET';

    const result =
      method === 'POST'
        ? await this.httpClient.post(config.endpoint, config.body)
        : await this.httpClient.get(config.endpoint);

    if (result.isErr()) {
      return err(result.error);
    }

    return ok(config.validate(result.value));
  }

  /**
   * Benchmark API to find optimal rate limits
   * Tests both sustained per-second rates and per-minute burst limits
   * @param maxRequestsPerSecond - Maximum sustained rate to test (default: 5)
   * @param testBurstLimits - Whether to test per-minute burst limits (default: true)
   * @param customRates - Optional custom rates to test instead of default progression
   * @param numRequestsPerTest - Number of requests to send per rate test (default: 10)
   * @returns Recommended rate limit config
   */
  async benchmarkRateLimit(
    maxRequestsPerSecond = 5,
    numRequestsPerTest = 10,
    testBurstLimits = true,
    customRates?: number[]
  ): Promise<{
    burstLimits?: { limit: number; success: boolean }[];
    maxSafeRate: number;
    recommended: RateLimitConfig;
    testResults: { rate: number; responseTimeMs?: number; success: boolean }[];
  }> {
    this.logger.info(`Starting rate limit benchmark for ${this.metadata.displayName}`);

    // Create benchmark client with no rate limiting and no retries
    const benchmarkClient = new HttpClient({
      baseUrl: this.baseUrl,
      providerName: `${this.metadata.name}-benchmark`,
      rateLimit: {
        burstLimit: 1000,
        requestsPerHour: 100000,
        requestsPerMinute: 10000,
        requestsPerSecond: 1000,
      },
      retries: 1, // 1 attempt = no retries, failures (including 429) fail immediately
      timeout: 5000, // Shorter timeout for faster failure detection
    });

    // Temporarily swap to benchmark client
    const originalClient = this.httpClient;
    this.httpClient = benchmarkClient;

    const testResults: { rate: number; responseTimeMs?: number; success: boolean }[] = [];
    let maxSafeRate = 0.25; // Start conservative
    let baselineResponseTime: number | undefined;
    let totalRequests = 0;
    const benchmarkStartTime = Date.now();

    try {
      // Test per-minute burst limits first (faster to detect hard limits)
      let burstLimits: { limit: number; success: boolean }[] | undefined;
      let maxSafeBurstPerMinute: number | undefined;

      if (testBurstLimits) {
        this.logger.info('🔥 Starting per-minute burst limit tests...\n');
        burstLimits = [];

        // Test burst limits: 10, 15, 20, 30, 60 requests per minute
        const burstLimitsToTest = [10, 15, 20, 30, 60];

        for (const burstLimit of burstLimitsToTest) {
          this.logger.info(`Testing burst: ${burstLimit} requests/minute (sending rapidly)`);

          const burstStartTime = Date.now();
          let burstSuccess = true;
          const burstResponseTimes: number[] = [];
          let failedOnRequest: number | undefined;

          // Send requests in parallel batches to truly test burst limits
          for (let batch = 0; batch < Math.ceil(burstLimit / BURST_BENCHMARK_BATCH_SIZE); batch++) {
            const batchStart = batch * BURST_BENCHMARK_BATCH_SIZE;
            const batchEnd = Math.min(batchStart + BURST_BENCHMARK_BATCH_SIZE, burstLimit);
            const batchPromises: Promise<number>[] = [];

            for (let i = batchStart; i < batchEnd; i++) {
              const promise = (async () => {
                const start = Date.now();
                const result = await this.isHealthy();

                if (result.isErr()) {
                  // Check if it's a RateLimitError - this is a hard failure
                  if (result.error instanceof RateLimitError) {
                    failedOnRequest = i + 1;
                    throw result.error;
                  }
                  // Other errors (timeout, network) also fail the test
                  if (result.error.message.includes('timeout') || result.error.message.includes('network')) {
                    failedOnRequest = i + 1;
                    throw result.error;
                  }
                  throw result.error;
                }

                if (!result.value) {
                  throw new Error('Health check returned false');
                }

                const responseTime = Date.now() - start;
                return responseTime;
              })();
              batchPromises.push(promise);
            }

            try {
              const batchResults = await Promise.all(batchPromises);
              burstResponseTimes.push(...batchResults);
            } catch (error) {
              // RateLimitError or timeout means we hit the burst limit
              if (error instanceof RateLimitError || (error instanceof Error && error.message.includes('timeout'))) {
                this.logger.warn(
                  `Burst limit hit at ${burstLimit} req/min on request #${failedOnRequest}/${burstLimit}`
                );
                burstSuccess = false;
                break;
              }
              throw error;
            }

            // Tiny delay between batches to avoid overwhelming connection pool
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

          if (burstSuccess) {
            maxSafeBurstPerMinute = burstLimit;
            this.logger.info(
              `✅ Burst ${burstLimit} req/min succeeded - Completed ${burstResponseTimes.length} requests in ${burstDuration.toFixed(1)}s (${actualRate.toFixed(1)} req/sec actual), AvgResponseTime: ${avgBurstResponseTime?.toFixed(0)}ms`
            );
          } else {
            this.logger.warn(
              `❌ Burst ${burstLimit} req/min failed - ${burstResponseTimes.length} requests completed in ${burstDuration.toFixed(1)}s before hitting limit`
            );
            break;
          }

          // Wait 60 seconds before next burst test
          this.logger.debug('Waiting 60 seconds before next burst test...');
          await new Promise((resolve) => setTimeout(resolve, 60000));
        }

        if (maxSafeBurstPerMinute) {
          this.logger.info(`\nMax safe burst detected: ${maxSafeBurstPerMinute} requests/minute`);
          // Use burst limit to inform sustained rate testing
          const impliedMaxRate = maxSafeBurstPerMinute / 60;
          if (impliedMaxRate < maxRequestsPerSecond) {
            this.logger.info(
              `📊 Burst limit implies max sustained rate of ~${impliedMaxRate.toFixed(2)} req/sec, adjusting test range...`
            );
            maxRequestsPerSecond = Math.min(maxRequestsPerSecond, impliedMaxRate);
          }
        }

        this.logger.info('\n');
      }

      // Test sustained per-second rates
      this.logger.info('⏱️  Starting sustained rate tests...\n');
      const ratesToTest = customRates
        ? customRates.sort((a, b) => a - b) // Use custom rates if provided, sorted ascending
        : [0.25, 0.5, 1.0, 2.5, 5.0, maxRequestsPerSecond].filter((r) => r <= maxRequestsPerSecond);

      for (const rate of ratesToTest) {
        const rateTestStartTime = Date.now();
        const elapsedMinutes = (rateTestStartTime - benchmarkStartTime) / 60000;

        this.logger.info(
          `Testing rate: ${rate} req/sec - Total requests so far: ${totalRequests}, Elapsed: ${elapsedMinutes.toFixed(1)}min`
        );

        const delayMs = Math.floor(1000 / rate);
        let success = true;
        const responseTimes: number[] = [];
        let hadTimeout = false;
        let failedOnRequestNumber: number | undefined;

        // Make requests at this rate
        for (let i = 0; i < numRequestsPerTest; i++) {
          totalRequests++;
          const start = Date.now();
          const result = await this.isHealthy();

          if (result.isErr()) {
            // Check for RateLimitError - hard failure
            if (result.error instanceof RateLimitError) {
              this.logger.warn(
                `Hit explicit 429 rate limit at ${rate} req/sec on request #${i + 1}/${numRequestsPerTest} (total: ${totalRequests})`
              );
              failedOnRequestNumber = i + 1;
              success = false;
              break;
            }
            // Check for timeout - soft rate limiting indicator
            if (result.error.message.includes('timeout')) {
              this.logger.warn(
                `Request timeout at ${rate} req/sec on request #${i + 1}/${numRequestsPerTest} (total: ${totalRequests}) - possible soft rate limiting`
              );
              failedOnRequestNumber = i + 1;
              hadTimeout = true;
              // Continue to collect more data points, but flag this rate
            } else {
              throw result.error; // Re-throw non-rate-limit errors
            }
          } else {
            if (!result.value) {
              throw new Error('Health check returned false');
            }
            const responseTime = Date.now() - start;
            responseTimes.push(responseTime);
          }

          if (i < numRequestsPerTest - 1) {
            // Wait between requests (except after last one)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }

        const rateTestDuration = Date.now() - rateTestStartTime;
        this.logger.debug(`Rate test completed in ${(rateTestDuration / 1000).toFixed(1)}s`);

        const avgResponseTime =
          responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : undefined;

        // Establish baseline from first successful test
        if (!baselineResponseTime && avgResponseTime) {
          baselineResponseTime = avgResponseTime;
          this.logger.debug(`Baseline response time established: ${baselineResponseTime.toFixed(0)}ms`);
        }

        // Detect soft rate limiting: response time increased significantly or had timeouts
        if (avgResponseTime && baselineResponseTime) {
          const slowdownFactor = avgResponseTime / baselineResponseTime;
          if (slowdownFactor > 3 || hadTimeout) {
            this.logger.warn(
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

        if (success) {
          maxSafeRate = rate;
          this.logger.info(`Rate ${rate} req/sec succeeded - AvgResponseTime: ${avgResponseTime?.toFixed(0)}ms`);
        } else {
          const elapsedSinceStart = (Date.now() - benchmarkStartTime) / 1000;
          this.logger.warn(
            `Rate ${rate} req/sec failed - Failed on request #${failedOnRequestNumber || 'unknown'}, Total requests: ${totalRequests}, Time since start: ${elapsedSinceStart.toFixed(1)}s`
          );

          // Suggest possible limit type based on failure pattern
          if (failedOnRequestNumber && totalRequests >= 10) {
            const avgRequestsPerMinute = (totalRequests / (elapsedSinceStart / 60)).toFixed(1);
            this.logger.info(
              `📊 Average rate so far: ${avgRequestsPerMinute} req/min. If this is close to a round number (10, 15, 20, 30, 60), the API may have a per-minute limit.`
            );
          }

          break;
        }

        // Longer pause between rate tests to let sliding windows clear (60 seconds)
        this.logger.debug('Waiting 60 seconds before next rate test to clear any sliding windows...');
        await new Promise((resolve) => setTimeout(resolve, 60000));
      }

      // Calculate recommended config with 80% safety margin
      const safeRate = maxSafeRate * 0.8;
      const recommended: RateLimitConfig = {
        burstLimit: Math.max(3, Math.ceil(safeRate * 2)), // Allow short bursts
        requestsPerHour: Math.floor(safeRate * 3600 * 0.9), // 90% of theoretical max
        requestsPerMinute: maxSafeBurstPerMinute
          ? Math.floor(maxSafeBurstPerMinute * 0.8)
          : Math.floor(safeRate * 60 * 0.9),
        requestsPerSecond: Math.round(safeRate * 100) / 100, // Round to 2 decimals
      };

      this.logger.info(
        `\nBenchmark complete - MaxSafeRate: ${maxSafeRate} req/sec, Recommended: ${JSON.stringify(recommended)}`
      );

      return {
        ...(burstLimits && { burstLimits }),
        maxSafeRate,
        recommended,
        testResults,
      };
    } finally {
      // Always restore original client
      this.httpClient = originalClient;
    }
  }

  // Provider interface properties from metadata
  get name(): string {
    return this.metadata.name;
  }

  get rateLimit(): RateLimitConfig {
    return this.metadata.defaultConfig.rateLimit;
  }

  /**
   * Cleanup resources.
   * Delegates to httpClient.destroy() to cleanup HTTP connections.
   */
  destroy(): void {
    this.httpClient.destroy();
  }

  /**
   * Convenience wrapper around the shared streaming adapter. Providers can call
   * this to reuse the standardized pagination/dedup/replay/cursor handling while
   * only supplying fetch + map logic. Keeps inheritance consumers ergonomic while
   * preserving the standalone helper as the single source of truth.
   *
   * Use cases:
   * - Simple providers: call streamWithPagination and provide fetchPage/mapItem.
   * - Complex pagination (Solana/NEAR/Subscan): also pass derivePageParams to
   *   translate persisted CursorState into the provider’s pagination dialect
   *   (signatures, page numbers, before/slot, etc.).
   */
  protected streamWithPagination<Raw, Tx extends NormalizedTransactionBase = NormalizedTransactionBase>(
    config: Omit<
      StreamingAdapterOptions<Raw, Tx>,
      'providerName' | 'logger' | 'extractCursors' | 'applyReplayWindow'
    > & {
      applyReplayWindow?: ((cursor: PaginationCursor) => PaginationCursor) | undefined;
      extractCursors?: ((tx: Tx) => PaginationCursor[]) | undefined;
    }
  ): AsyncIterableIterator<Result<StreamingBatchResult<Tx>, Error>> {
    const extractCursors = config.extractCursors ?? ((tx: Tx) => this.extractCursors(tx as unknown as never));
    const applyReplayWindow =
      config.applyReplayWindow ?? ((cursor: PaginationCursor) => this.applyReplayWindow(cursor));

    return createStreamingIterator<Raw, Tx>({
      ...config,
      providerName: this.name,
      logger: this.logger,
      extractCursors,
      applyReplayWindow,
    });
  }

  /**
   * Reinitialize HTTP client with custom configuration
   * Useful for providers that need special URL formatting or headers
   */
  protected reinitializeHttpClient(config: {
    baseUrl?: string | undefined;
    defaultHeaders?: Record<string, string> | undefined;
    providerName?: string | undefined;
    rateLimit?: RateLimitConfig | undefined;
    retries?: number | undefined;
    timeout?: number | undefined;
  }): void {
    const clientConfig = {
      baseUrl: config.baseUrl || this.baseUrl,
      instrumentation: this.config.instrumentation,
      providerName: config.providerName || this.metadata.name,
      rateLimit: config.rateLimit || this.metadata.defaultConfig.rateLimit,
      retries: config.retries || this.metadata.defaultConfig.retries,
      service: 'blockchain' as const,
      timeout: config.timeout || this.metadata.defaultConfig.timeout,
      ...(config.defaultHeaders && { defaultHeaders: config.defaultHeaders }),
    };

    this.httpClient = new HttpClient(clientConfig);
  }

  // Common validation helper
  protected validateApiKey(): void {
    if (this.metadata.requiresApiKey && this.apiKey === 'YourApiKeyToken') {
      const envVar = this.metadata.apiKeyEnvVar || `${this.metadata.name.toUpperCase()}_API_KEY`;
      throw new Error(
        `Valid API key required for ${this.metadata.displayName}. ` + `Set environment variable: ${envVar}`
      );
    }
  }

  private getApiKey(): string {
    // If no API key support at all (not required and no env var specified), return empty
    if (!this.metadata.requiresApiKey && !this.metadata.apiKeyEnvVar) {
      return '';
    }

    const envVar = this.metadata.apiKeyEnvVar || `${this.metadata.name.toUpperCase()}_API_KEY`;
    const apiKey = process.env[envVar];

    if (!apiKey || apiKey === 'YourApiKeyToken') {
      // Only warn/return placeholder if API key is required
      if (this.metadata.requiresApiKey) {
        this.logger.warn(`No API key found for ${this.metadata.displayName}. ` + `Set environment variable: ${envVar}`);
        return 'YourApiKeyToken';
      }
      // For optional API keys, silently return empty string
      return '';
    }

    return apiKey;
  }
}
