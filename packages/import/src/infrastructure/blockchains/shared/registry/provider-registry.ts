import type { RateLimitConfig } from '@exitbook/shared-utils';

import type { IBlockchainProvider, ProviderCapabilities } from '../types.js';

/**
 * Network configuration for a provider
 */
export interface NetworkEndpoint {
  baseUrl: string;
  websocketUrl?: string | undefined;
}

/**
 * Provider metadata that's embedded in the provider class
 */
export interface ProviderMetadata {
  apiKeyEnvVar?: string | undefined; // Environment variable name for API key
  blockchain: string;
  capabilities: ProviderCapabilities;
  defaultConfig: {
    rateLimit: RateLimitConfig;
    retries: number;
    timeout: number;
  };
  description?: string | undefined;
  displayName: string;
  name: string;
  networks: {
    devnet?: NetworkEndpoint | undefined;
    mainnet: NetworkEndpoint;
    testnet?: NetworkEndpoint | undefined;
  };
  requiresApiKey?: boolean | undefined;
  type?: 'rest' | 'rpc' | 'websocket' | undefined;
}

/**
 * Factory function to create provider instances
 */
export interface ProviderFactory {
  create: (config: unknown) => IBlockchainProvider;
  metadata: ProviderMetadata;
}

/**
 * Information about an available provider
 */
export interface ProviderInfo {
  blockchain: string;
  capabilities: ProviderCapabilities;
  defaultConfig: ProviderMetadata['defaultConfig'];
  description?: string | undefined;
  displayName: string;
  name: string;
  requiresApiKey: boolean;
  supportedNetworks: string[];
  type: string;
}

/**
 * Central registry for blockchain providers
 */
export class ProviderRegistry {
  private static providers = new Map<string, ProviderFactory>();

  /**
   * Create a provider instance
   */
  static createProvider(blockchain: string, name: string, config: unknown): IBlockchainProvider {
    const key = `${blockchain}:${name}`;
    const factory = this.providers.get(key);

    if (!factory) {
      const available = this.getAvailable(blockchain).map((p) => p.name);
      throw new Error(
        `Provider '${name}' not found for blockchain ${blockchain}.\n` +
          `💡 Available providers: ${available.join(', ')}\n` +
          `💡 Run 'pnpm run providers:list --blockchain ${blockchain}' to see all options\n` +
          `💡 Check for typos in provider name: '${name}'\n` +
          `💡 Use 'pnpm run providers:sync --fix' to sync configuration`
      );
    }

    return factory.create(config);
  }

  /**
   * Get all registered providers
   */
  static getAllProviders(): ProviderInfo[] {
    const blockchains = new Set(Array.from(this.providers.keys()).map((key) => key.split(':')[0]));

    return Array.from(blockchains)
      .filter((blockchain) => blockchain !== undefined)
      .flatMap((blockchain) => this.getAvailable(blockchain));
  }

  /**
   * Get all available providers for a blockchain
   */
  static getAvailable(blockchain: string): ProviderInfo[] {
    return Array.from(this.providers.entries())
      .filter(([key]) => key.startsWith(`${blockchain}:`))
      .map(([_, factory]) => {
        return {
          blockchain: factory.metadata.blockchain,
          capabilities: factory.metadata.capabilities,
          defaultConfig: factory.metadata.defaultConfig,
          description: factory.metadata.description || '',
          displayName: factory.metadata.displayName,
          name: factory.metadata.name,
          requiresApiKey: factory.metadata.requiresApiKey || false,
          supportedNetworks: Object.keys(factory.metadata.networks),
          type: factory.metadata.type || 'rest',
        };
      });
  }

  /**
   * Get provider metadata
   */
  static getMetadata(blockchain: string, name: string): ProviderMetadata | undefined {
    const key = `${blockchain}:${name}`;
    const factory = this.providers.get(key);
    return factory?.metadata || undefined;
  }

  /**
   * Check if a provider is registered
   */
  static isRegistered(blockchain: string, name: string): boolean {
    return this.providers.has(`${blockchain}:${name}`);
  }

  /**
   * Register a provider with the registry
   */
  static register(factory: ProviderFactory): void {
    const key = `${factory.metadata.blockchain}:${factory.metadata.name}`;

    if (this.providers.has(key)) {
      throw new Error(`Provider ${key} is already registered`);
    }

    this.providers.set(key, factory);
  }

  /**
   * Validate provider configuration against registered providers
   * Supports both legacy (explorers array) and new (override-based) formats
   */
  static validateConfig(config: Record<string, unknown>): {
    errors: string[];
    valid: boolean;
  } {
    const errors: string[] = [];

    for (const [blockchain, blockchainConfig] of Object.entries(config)) {
      if (!blockchainConfig || typeof blockchainConfig !== 'object') {
        continue;
      }

      const configObj = blockchainConfig as {
        defaultEnabled?: string[];
        explorers?: unknown[];
        overrides?: Record<string, unknown>;
      };

      const availableProviders = this.getAvailable(blockchain);
      const availableNames = availableProviders.map((p) => p.name);

      // Handle legacy format (explorers array)
      if (configObj.explorers) {
        for (const explorer of configObj.explorers) {
          const explorerObj = explorer as { name?: string };
          if (!explorerObj.name) {
            errors.push(`Missing name for explorer in blockchain ${blockchain}`);
            continue;
          }

          if (!availableNames.includes(explorerObj.name)) {
            errors.push(
              `Unknown provider '${explorerObj.name}' for blockchain '${blockchain}'. ` +
                `Available: ${availableNames.join(', ')}`
            );
          }
        }
      }

      // Handle new override-based format
      if (configObj.defaultEnabled) {
        for (const providerName of configObj.defaultEnabled) {
          if (!availableNames.includes(providerName)) {
            errors.push(
              `Unknown provider '${providerName}' in defaultEnabled for blockchain '${blockchain}'. ` +
                `Available: ${availableNames.join(', ')}`
            );
          }
        }
      }

      // Validate overrides section
      if (configObj.overrides) {
        for (const providerName of Object.keys(configObj.overrides)) {
          if (!availableNames.includes(providerName)) {
            errors.push(
              `Unknown provider '${providerName}' in overrides for blockchain '${blockchain}'. ` +
                `Available: ${availableNames.join(', ')}`
            );
          }
        }
      }
    }

    return {
      errors,
      valid: errors.length === 0,
    };
  }
}
