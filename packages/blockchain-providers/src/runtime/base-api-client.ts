import type { CursorState, PaginationCursor } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import type { RateLimitConfig } from '@exitbook/http';
import { HttpClient } from '@exitbook/http';
import type { Logger } from '@exitbook/logger';
import { getLogger } from '@exitbook/logger';

import type {
  IBlockchainProvider,
  OneShotOperation,
  OneShotOperationResult,
  ProviderCapabilities,
  ProviderConfig,
  ProviderMetadata,
  StreamingBatchResult,
  StreamingOperation,
} from '../contracts/index.js';
import type { NormalizedTransactionBase } from '../contracts/normalized-transaction.js';

import { createStreamingIterator, type StreamingAdapterOptions } from './streaming/adapter.js';

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
    this.metadata = config.metadata;

    this.logger = getLogger(`${this.metadata.displayName.replace(/\s+/g, '')}`);

    this.baseUrl = config.baseUrl;
    this.apiKey = this.getApiKey();
    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      instrumentation: config.instrumentation,
      hooks: config.requestHooks,
      providerName: this.metadata.name,
      rateLimit: config.rateLimit,
      retries: config.retries,
      service: 'blockchain',
      timeout: config.timeout,
    });

    this.logger.debug(`Initialized ${this.metadata.displayName} for ${config.blockchain} - BaseUrl: ${this.baseUrl}`);
  }

  get blockchain(): string {
    return this.config.blockchain;
  }

  get capabilities(): ProviderCapabilities {
    return this.metadata.capabilities;
  }

  abstract execute<TOperation extends OneShotOperation>(
    operation: TOperation
  ): Promise<Result<OneShotOperationResult<TOperation>, Error>>;

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
   * Default implementation yields a single Err result - providers should implement when ready for Phase 1+
   */
  async *executeStreaming<T extends NormalizedTransactionBase = NormalizedTransactionBase>(
    _operation: StreamingOperation,
    _cursor?: CursorState
  ): AsyncIterableIterator<Result<StreamingBatchResult<T>, Error>> {
    yield err(new Error(`Streaming pagination not yet implemented for ${this.name}. Use execute() method instead.`));
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
   */
  async isHealthy(): Promise<Result<boolean, Error>> {
    return this.runHealthCheck(this.httpClient);
  }

  /**
   * Create an unbounded health check function for benchmarking.
   * Returns a health check that bypasses the provider's rate limiter, along with
   * a destroy function to clean up the temporary HTTP client.
   */
  createUnboundedHealthCheck(): {
    checkHealth: () => Promise<Result<boolean, Error>>;
    destroy: () => Promise<void>;
  } {
    const client = new HttpClient({
      baseUrl: this.baseUrl,
      providerName: `${this.metadata.name}-benchmark`,
      rateLimit: {
        burstLimit: 1000,
        requestsPerHour: 100000,
        requestsPerMinute: 10000,
        requestsPerSecond: 1000,
      },
      retries: 1,
      timeout: 5000,
    });

    return { checkHealth: () => this.runHealthCheck(client), destroy: () => client.close() };
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
   * Delegates to httpClient.close() to cleanup HTTP connections.
   *
   * Idempotent: safe to call multiple times.
   */
  async destroy(): Promise<void> {
    await this.httpClient.close();
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
      baseUrl: config.baseUrl ?? this.baseUrl,
      instrumentation: this.config.instrumentation,
      hooks: this.config.requestHooks,
      providerName: config.providerName ?? this.metadata.name,
      rateLimit: config.rateLimit ?? this.metadata.defaultConfig.rateLimit,
      retries: config.retries ?? this.metadata.defaultConfig.retries,
      service: 'blockchain' as const,
      timeout: config.timeout ?? this.metadata.defaultConfig.timeout,
      ...(config.defaultHeaders && { defaultHeaders: config.defaultHeaders }),
    };

    this.httpClient.close().catch((error: unknown) => {
      this.logger.warn({ error }, 'Failed to close previous HTTP client during reinitialization');
    });
    this.httpClient = new HttpClient(clientConfig);
  }

  // Common validation helper
  protected validateApiKey(): void {
    if (this.metadata.requiresApiKey && !this.apiKey) {
      throw this.createMissingApiKeyError();
    }
  }

  private getApiKey(): string {
    if (this.config.apiKey && this.config.apiKey !== 'YourApiKeyToken') {
      return this.config.apiKey;
    }

    // If no API key support at all (not required and no env var specified), return empty
    if (!this.metadata.requiresApiKey && !this.metadata.apiKeyEnvName) {
      return '';
    }

    if (!this.config.apiKey || this.config.apiKey === 'YourApiKeyToken') {
      const envVar = this.metadata.apiKeyEnvName || `${this.metadata.name.toUpperCase()}_API_KEY`;
      if (this.metadata.requiresApiKey) {
        const error = this.createMissingApiKeyError(envVar);
        this.logger.warn(error.message);
        throw error;
      }
      // For optional API keys, silently return empty string
      return '';
    }

    return this.config.apiKey;
  }

  private createMissingApiKeyError(envVar?: string): Error {
    const resolvedEnvVar = envVar || this.metadata.apiKeyEnvName || `${this.metadata.name.toUpperCase()}_API_KEY`;
    return new Error(
      `Valid API key required for ${this.metadata.displayName}. Set environment variable: ${resolvedEnvVar}`
    );
  }

  private async runHealthCheck(client: HttpClient): Promise<Result<boolean, Error>> {
    const config = this.getHealthCheckConfig();
    const method = config.method ?? 'GET';
    const result =
      method === 'POST' ? await client.post(config.endpoint, config.body) : await client.get(config.endpoint);

    if (result.isErr()) {
      return err(result.error);
    }

    return ok(config.validate(result.value));
  }
}
