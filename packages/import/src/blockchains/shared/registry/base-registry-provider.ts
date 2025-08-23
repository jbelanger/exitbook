import type { RateLimitConfig } from "@crypto/core";
import type { Logger } from "@crypto/shared-logger";
import { getLogger } from "@crypto/shared-logger";
import { HttpClient } from "@crypto/shared-utils";
import type {
  IBlockchainProvider,
  ProviderCapabilities,
  ProviderOperation,
} from "../types.ts";
import {
  ProviderRegistry,
  type ProviderMetadata,
} from "./provider-registry.ts";

/**
 * Abstract base class for registry-based providers
 * Handles all common provider functionality using registry metadata
 */
export abstract class BaseRegistryProvider implements IBlockchainProvider {
  protected readonly metadata: ProviderMetadata;
  protected httpClient: HttpClient;
  protected readonly logger: Logger;
  protected readonly apiKey: string;
  protected readonly baseUrl: string;
  protected readonly network: string;

  constructor(
    blockchain: string,
    providerName: string,
    network: string = "mainnet",
  ) {
    // Get metadata from registry
    const metadata = ProviderRegistry.getMetadata(blockchain, providerName);
    if (!metadata) {
      throw new Error(
        `Provider '${providerName}' not found in registry for blockchain '${blockchain}'`,
      );
    }
    this.metadata = metadata;

    this.logger = getLogger(`${this.metadata.displayName.replace(/\s+/g, "")}`);
    this.network = network;

    // Get base URL for the specified network
    this.baseUrl = this.getNetworkBaseUrl(network);

    // Get API key from environment if required
    this.apiKey = this.getApiKey();

    // Initialize HTTP client with registry metadata
    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      timeout: this.metadata.defaultConfig.timeout,
      retries: this.metadata.defaultConfig.retries,
      rateLimit: this.metadata.defaultConfig.rateLimit,
      providerName: this.metadata.name,
    });

    this.logger.debug(
      `Initialized ${this.metadata.displayName} - Network: ${this.network}, BaseUrl: ${this.baseUrl}, HasApiKey: ${this.apiKey !== "YourApiKeyToken"}`,
    );
  }

  // Provider interface properties from metadata
  get name(): string {
    return this.metadata.name;
  }

  get blockchain(): string {
    return this.metadata.blockchain;
  }

  get capabilities(): ProviderCapabilities {
    return this.metadata.capabilities;
  }

  get rateLimit(): RateLimitConfig {
    return this.metadata.defaultConfig.rateLimit;
  }

  // Common provider methods
  async testConnection(): Promise<boolean> {
    return this.isHealthy();
  }

  // Abstract methods that must be implemented by concrete providers
  abstract isHealthy(): Promise<boolean>;
  abstract execute<T>(operation: ProviderOperation<T>): Promise<T>;

  // Helper methods
  private getNetworkBaseUrl(network: string): string {
    const networks = this.metadata.networks as Record<
      string,
      { baseUrl: string; websocketUrl?: string }
    >;
    const networkConfig = networks[network];

    if (!networkConfig?.baseUrl) {
      const availableNetworks = Object.keys(this.metadata.networks);
      throw new Error(
        `Network '${network}' not supported by ${this.metadata.displayName}. ` +
          `Available networks: ${availableNetworks.join(", ")}`,
      );
    }

    return networkConfig.baseUrl;
  }

  private getApiKey(): string {
    if (!this.metadata.requiresApiKey) {
      return "";
    }

    const envVar =
      this.metadata.apiKeyEnvVar ||
      `${this.metadata.name.toUpperCase()}_API_KEY`;
    const apiKey = process.env[envVar];

    if (!apiKey || apiKey === "YourApiKeyToken") {
      this.logger.warn(
        `No API key found for ${this.metadata.displayName}. ` +
          `Set environment variable: ${envVar}`,
      );
      return "YourApiKeyToken";
    }

    return apiKey;
  }

  // Common validation helper
  protected validateApiKey(): void {
    if (this.metadata.requiresApiKey && this.apiKey === "YourApiKeyToken") {
      const envVar =
        this.metadata.apiKeyEnvVar ||
        `${this.metadata.name.toUpperCase()}_API_KEY`;
      throw new Error(
        `Valid API key required for ${this.metadata.displayName}. ` +
          `Set environment variable: ${envVar}`,
      );
    }
  }

  /**
   * Reinitialize HTTP client with custom configuration
   * Useful for providers that need special URL formatting or headers
   */
  protected reinitializeHttpClient(config: {
    baseUrl?: string;
    timeout?: number;
    retries?: number;
    rateLimit?: RateLimitConfig;
    providerName?: string;
    defaultHeaders?: Record<string, string>;
  }): void {
    const clientConfig = {
      baseUrl: config.baseUrl || this.baseUrl,
      timeout: config.timeout || this.metadata.defaultConfig.timeout,
      retries: config.retries || this.metadata.defaultConfig.retries,
      rateLimit: config.rateLimit || this.metadata.defaultConfig.rateLimit,
      providerName: config.providerName || this.metadata.name,
      ...(config.defaultHeaders && { defaultHeaders: config.defaultHeaders }),
    };

    this.httpClient = new HttpClient(clientConfig);
  }
}
