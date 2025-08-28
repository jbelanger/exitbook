import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';
import { HttpClient } from '@crypto/shared-utils';

import { BaseRegistryProvider } from '../registry/base-registry-provider.ts';

/**
 * Abstract base class for Tatum multi-blockchain API clients
 * Handles common Tatum-specific logic including authentication, rate limiting, and error handling
 */
export abstract class TatumApiClientBase<TTx, TBalance> extends BaseRegistryProvider {
  constructor(blockchain: string, providerName: string, network: string = 'mainnet') {
    super(blockchain, providerName, network);

    // Reinitialize HTTP client with Tatum-specific headers
    this.reinitializeHttpClient({
      baseUrl: `https://api.tatum.io/v3/${this.blockchain}`,
      defaultHeaders: {
        accept: 'application/json',
        'x-api-key': this.apiKey,
      },
    });

    this.logger.debug(
      `Initialized ${this.metadata.displayName} for ${blockchain} - Network: ${this.network}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
  }

  /**
   * Get paginated results with configurable batch size
   * Supports Tatum's pagination pattern
   */
  protected async getPaginatedResults<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
    maxResults?: number
  ): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;
    const pageSize = Math.min((params.pageSize as number) || 50, 50); // Tatum max is 50

    while (true) {
      const pageParams = { ...params, offset, pageSize };
      const pageResults = await this.makeRequest<T[]>(endpoint, pageParams);

      if (!Array.isArray(pageResults) || pageResults.length === 0) {
        break;
      }

      results.push(...pageResults);

      // Stop if we've reached maxResults or got less than a full page
      if ((maxResults && results.length >= maxResults) || pageResults.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return maxResults ? results.slice(0, maxResults) : results;
  }

  abstract getRawAddressBalance(address: string): Promise<TBalance>;

  // Abstract methods that each blockchain implementation must provide
  abstract getRawAddressTransactions(address: string, params?: Record<string, unknown>): Promise<TTx[]>;
  async isHealthy(): Promise<boolean> {
    try {
      // Test with a simple endpoint - each blockchain should override if needed
      await this.httpClient.get('/');
      return true;
    } catch (error) {
      this.logger.warn(`Health check failed - Error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Make a request to the Tatum API with common error handling
   */
  protected async makeRequest<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    this.validateApiKey();

    try {
      const response = await this.httpClient.get<T>(endpoint, params);
      return response;
    } catch (error) {
      this.logger.error(
        `Tatum API request failed - Blockchain: ${this.blockchain}, Endpoint: ${endpoint}, Error: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
