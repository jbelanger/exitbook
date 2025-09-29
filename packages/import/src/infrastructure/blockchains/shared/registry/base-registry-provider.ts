import type { Logger } from '@exitbook/shared-logger';
import { getLogger } from '@exitbook/shared-logger';
import type { RateLimitConfig } from '@exitbook/shared-utils';
import { HttpClient } from '@exitbook/shared-utils';

import type { IBlockchainProvider, ProviderCapabilities, ProviderOperation } from '../types.js';

import { type ProviderMetadata, ProviderRegistry } from './provider-registry.js';

/**
 * Abstract base class for registry-based providers
 * Handles all common provider functionality using registry metadata
 */
export abstract class BaseRegistryProvider implements IBlockchainProvider {
  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected httpClient: HttpClient;
  protected readonly logger: Logger;
  protected readonly metadata: ProviderMetadata;
  protected readonly network: string;

  constructor(blockchain: string, providerName: string, network = 'mainnet') {
    // Get metadata from registry
    const metadata = ProviderRegistry.getMetadata(blockchain, providerName);
    if (!metadata) {
      const available = ProviderRegistry.getAvailable(blockchain)
        .map((p) => p.name)
        .join(', ');
      const suggestions = [
        `💡 Available providers for ${blockchain}: ${available}`,
        `💡 Run 'pnpm run providers:list --blockchain ${blockchain}' to see all options`,
        `💡 Check for typos in provider name: '${providerName}'`,
        `💡 Use 'pnpm run providers:sync --fix' to sync configuration`,
      ];

      throw new Error(
        `Provider '${providerName}' not found in registry for blockchain '${blockchain}'.\n${suggestions.join('\n')}`
      );
    }
    this.metadata = metadata;

    this.logger = getLogger(`${this.metadata.displayName.replace(/\s+/g, '')}`);
    this.network = network;

    // Get base URL for the specified network
    this.baseUrl = this.getNetworkBaseUrl(network);

    // Get API key from environment if required
    this.apiKey = this.getApiKey();

    // Initialize HTTP client with registry metadata
    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      providerName: this.metadata.name,
      rateLimit: this.metadata.defaultConfig.rateLimit,
      retries: this.metadata.defaultConfig.retries,
      timeout: this.metadata.defaultConfig.timeout,
    });

    this.logger.debug(
      `Initialized ${this.metadata.displayName} - Network: ${this.network}, BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== 'YourApiKeyToken'}`
    );
  }

  get blockchain(): string {
    return this.metadata.blockchain;
  }

  get capabilities(): ProviderCapabilities {
    return this.metadata.capabilities;
  }

  abstract execute<T>(operation: ProviderOperation<T>, config?: Record<string, unknown>): Promise<T>;

  // Abstract methods that must be implemented by concrete providers
  abstract isHealthy(): Promise<boolean>;
  // Provider interface properties from metadata
  get name(): string {
    return this.metadata.name;
  }

  get rateLimit(): RateLimitConfig {
    return this.metadata.defaultConfig.rateLimit;
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
      providerName: config.providerName || this.metadata.name,
      rateLimit: config.rateLimit || this.metadata.defaultConfig.rateLimit,
      retries: config.retries || this.metadata.defaultConfig.retries,
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
    if (!this.metadata.requiresApiKey) {
      return '';
    }

    const envVar = this.metadata.apiKeyEnvVar || `${this.metadata.name.toUpperCase()}_API_KEY`;
    const apiKey = process.env[envVar];

    if (!apiKey || apiKey === 'YourApiKeyToken') {
      this.logger.warn(`No API key found for ${this.metadata.displayName}. ` + `Set environment variable: ${envVar}`);
      return 'YourApiKeyToken';
    }

    return apiKey;
  }

  // Helper methods
  private getNetworkBaseUrl(network: string): string {
    const networks = this.metadata.networks as Record<string, { baseUrl: string; websocketUrl?: string }>;
    const networkConfig = networks[network];

    if (!networkConfig?.baseUrl) {
      const availableNetworks = Object.keys(this.metadata.networks);
      throw new Error(
        `Network '${network}' not supported by ${this.metadata.displayName}. ` +
          `Available networks: ${availableNetworks.join(', ')}`
      );
    }

    return networkConfig.baseUrl;
  }
}
