import type { RateLimitConfig } from '@crypto/core';
import type { IBlockchainProvider, ProviderCapabilities } from '../types.ts';

/**
 * Network configuration for a provider
 */
export interface NetworkEndpoint {
  baseUrl: string;
  websocketUrl?: string;
}

/**
 * Provider metadata that's embedded in the provider class
 */
export interface ProviderMetadata {
  name: string;
  blockchain: string;
  displayName: string;
  description?: string;
  requiresApiKey?: boolean;
  apiKeyEnvVar?: string; // Environment variable name for API key
  type?: 'rest' | 'rpc' | 'websocket';
  capabilities: ProviderCapabilities;
  defaultConfig: {
    timeout: number;
    retries: number;
    rateLimit: RateLimitConfig;
  };
  networks: {
    mainnet: NetworkEndpoint;
    testnet?: NetworkEndpoint;
    devnet?: NetworkEndpoint;
  };
}

/**
 * Factory function to create provider instances
 */
export type ProviderFactory<TConfig = any> = {
  metadata: ProviderMetadata;
  create: (config: TConfig) => IBlockchainProvider<TConfig>;
};

/**
 * Information about an available provider
 */
export interface ProviderInfo {
  name: string;
  blockchain: string;
  displayName: string;
  description?: string;
  requiresApiKey: boolean;
  type: string;
  capabilities: ProviderCapabilities;
  defaultConfig: ProviderMetadata['defaultConfig'];
  supportedNetworks: string[];
}

/**
 * Central registry for blockchain providers
 */
export class ProviderRegistry {
  private static providers = new Map<string, ProviderFactory>();

  /**
   * Register a provider with the registry
   */
  static register<TConfig>(factory: ProviderFactory<TConfig>): void {
    const key = `${factory.metadata.blockchain}:${factory.metadata.name}`;

    if (this.providers.has(key)) {
      throw new Error(`Provider ${key} is already registered`);
    }

    this.providers.set(key, factory);
  }

  /**
   * Get all available providers for a blockchain
   */
  static getAvailable(blockchain: string): ProviderInfo[] {
    return Array.from(this.providers.entries())
      .filter(([key]) => key.startsWith(`${blockchain}:`))
      .map(([_, factory]) => {
        // Create a temporary instance to get capabilities
        const tempInstance = factory.create({});

        return {
          name: factory.metadata.name,
          blockchain: factory.metadata.blockchain,
          displayName: factory.metadata.displayName,
          description: factory.metadata.description || '',
          requiresApiKey: factory.metadata.requiresApiKey || false,
          type: factory.metadata.type || 'rest',
          capabilities: tempInstance.capabilities,
          defaultConfig: factory.metadata.defaultConfig,
          supportedNetworks: Object.keys(factory.metadata.networks)
        };
      });
  }

  /**
   * Get all registered providers
   */
  static getAllProviders(): ProviderInfo[] {
    const blockchains = new Set(
      Array.from(this.providers.keys()).map(key => key.split(':')[0])
    );

    return Array.from(blockchains)
      .filter(blockchain => blockchain !== undefined)
      .flatMap(blockchain => this.getAvailable(blockchain!));
  }

  /**
   * Create a provider instance
   */
  static createProvider<TConfig>(
    blockchain: string,
    name: string,
    config: TConfig
  ): IBlockchainProvider<TConfig> {
    const key = `${blockchain}:${name}`;
    const factory = this.providers.get(key);

    if (!factory) {
      const available = this.getAvailable(blockchain).map(p => p.name);
      throw new Error(
        `Provider ${name} not found for blockchain ${blockchain}. ` +
        `Available providers: ${available.join(', ')}`
      );
    }

    return factory.create(config);
  }

  /**
   * Check if a provider is registered
   */
  static isRegistered(blockchain: string, name: string): boolean {
    return this.providers.has(`${blockchain}:${name}`);
  }

  /**
   * Get provider metadata
   */
  static getMetadata(blockchain: string, name: string): ProviderMetadata | null {
    const key = `${blockchain}:${name}`;
    const factory = this.providers.get(key);
    return factory?.metadata || null;
  }

  /**
   * Validate provider configuration against registered providers
   */
  static validateConfig(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [blockchain, blockchainConfig] of Object.entries(config)) {
      if (!blockchainConfig || typeof blockchainConfig !== 'object') {
        continue;
      }

      const { explorers = [] } = blockchainConfig as any;
      const availableProviders = this.getAvailable(blockchain);
      const availableNames = availableProviders.map(p => p.name);

      for (const explorer of explorers) {
        if (!explorer.name) {
          errors.push(`Missing name for explorer in blockchain ${blockchain}`);
          continue;
        }

        if (!availableNames.includes(explorer.name)) {
          errors.push(
            `Unknown provider '${explorer.name}' for blockchain '${blockchain}'. ` +
            `Available: ${availableNames.join(', ')}`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}