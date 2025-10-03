import type { RateLimitConfig } from '@exitbook/shared-utils';

import type { IBlockchainProvider, ProviderCapabilities } from '../types.js';

/**
 * Configuration passed to provider constructor
 * Built from metadata + runtime overrides
 */
export interface ProviderConfig {
  baseUrl: string;
  blockchain: string;
  displayName: string;
  enabled?: boolean | undefined;
  name: string;
  priority?: number | undefined;
  rateLimit: RateLimitConfig;
  requiresApiKey?: boolean | undefined;
  retries: number;
  timeout: number;
}

/**
 * Provider metadata that's embedded in the provider class
 */
export interface ProviderMetadata {
  apiKeyEnvVar?: string | undefined; // Environment variable name for API key
  baseUrl: string; // Default base URL (used if no chain-specific override)
  blockchain: string; // Primary blockchain (for backward compatibility)
  capabilities: ProviderCapabilities;
  defaultConfig: {
    rateLimit: RateLimitConfig;
    retries: number;
    timeout: number;
  };
  description?: string | undefined;
  displayName: string;
  name: string;
  requiresApiKey?: boolean | undefined;
  /**
   * Supported blockchains for multi-chain providers
   * - String array: ['ethereum', 'avalanche'] - uses baseUrl for all chains
   * - Object: { ethereum: { baseUrl: '...' }, avalanche: { baseUrl: '...' } } - per-chain config
   */
  supportedChains?: string[] | Record<string, { baseUrl: string }> | undefined;
}

/**
 * Factory function to create provider instances
 */
export interface ProviderFactory {
  create: (config: ProviderConfig) => IBlockchainProvider;
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
}

/**
 * Central registry for blockchain providers
 */
export class ProviderRegistry {
  private static providers = new Map<string, ProviderFactory>();

  /**
   * Create a provider instance
   * Supports multi-chain providers via supportedChains metadata
   */
  static createProvider(blockchain: string, name: string, config: ProviderConfig): IBlockchainProvider {
    // Try exact match first (primary blockchain)
    const exactKey = `${blockchain}:${name}`;
    let factory = this.providers.get(exactKey);

    // If not found, search for multi-chain provider that supports this blockchain
    if (!factory) {
      factory = Array.from(this.providers.values()).find((f) => {
        const chains = this.getSupportedChains(f.metadata);
        return f.metadata.name === name && chains.includes(blockchain);
      });
    }

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
   * Check if any providers are registered
   */
  static hasAnyProviders(): boolean {
    return this.providers.size > 0;
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
   * Supports multi-chain providers via supportedChains metadata
   */
  static getAvailable(blockchain: string): ProviderInfo[] {
    return Array.from(this.providers.values())
      .filter((factory) => {
        const chains = this.getSupportedChains(factory.metadata);
        return chains.includes(blockchain);
      })
      .map((factory) => {
        return {
          blockchain: factory.metadata.blockchain,
          capabilities: factory.metadata.capabilities,
          defaultConfig: factory.metadata.defaultConfig,
          description: factory.metadata.description || '',
          displayName: factory.metadata.displayName,
          name: factory.metadata.name,
          requiresApiKey: factory.metadata.requiresApiKey || false,
        };
      });
  }

  /**
   * Get provider metadata
   * Supports multi-chain providers via supportedChains metadata
   */
  static getMetadata(blockchain: string, name: string): ProviderMetadata | undefined {
    // Try exact match first
    const exactKey = `${blockchain}:${name}`;
    let factory = this.providers.get(exactKey);

    // If not found, search for multi-chain provider
    if (!factory) {
      factory = Array.from(this.providers.values()).find((f) => {
        const chains = this.getSupportedChains(f.metadata);
        return f.metadata.name === name && chains.includes(blockchain);
      });
    }

    return factory?.metadata || undefined;
  }

  /**
   * Check if a provider is registered
   * Supports multi-chain providers via supportedChains metadata
   */
  static isRegistered(blockchain: string, name: string): boolean {
    // Try exact match first
    const exactKey = `${blockchain}:${name}`;
    if (this.providers.has(exactKey)) {
      return true;
    }

    // Check if any multi-chain provider supports this blockchain
    return Array.from(this.providers.values()).some((factory) => {
      const chains = this.getSupportedChains(factory.metadata);
      return factory.metadata.name === name && chains.includes(blockchain);
    });
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
   * Create a default ProviderConfig from metadata
   * Useful for tests and manual provider instantiation
   * Automatically applies chain-specific baseUrl from supportedChains object format
   */
  static createDefaultConfig(blockchain: string, name: string): ProviderConfig {
    const metadata = this.getMetadata(blockchain, name);
    if (!metadata) {
      throw new Error(`Provider '${name}' not found for blockchain '${blockchain}'`);
    }

    // Determine baseUrl: use chain-specific if available, otherwise use default
    let baseUrl = metadata.baseUrl;

    // If supportedChains is an object format, extract chain-specific baseUrl
    if (metadata.supportedChains && !Array.isArray(metadata.supportedChains)) {
      const chainConfig = metadata.supportedChains[blockchain];
      if (chainConfig?.baseUrl) {
        baseUrl = chainConfig.baseUrl;
      }
    }

    return {
      baseUrl,
      blockchain,
      displayName: metadata.displayName,
      enabled: true,
      name: metadata.name,
      priority: 1,
      rateLimit: metadata.defaultConfig.rateLimit,
      requiresApiKey: metadata.requiresApiKey,
      retries: metadata.defaultConfig.retries,
      timeout: metadata.defaultConfig.timeout,
    };
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

  /**
   * Helper to get supported chains from metadata (handles both string[] and object formats)
   */
  private static getSupportedChains(metadata: ProviderMetadata): string[] {
    const { supportedChains, blockchain } = metadata;

    if (!supportedChains) {
      return [blockchain]; // Default to primary blockchain
    }

    if (Array.isArray(supportedChains)) {
      return supportedChains; // String array format
    }

    return Object.keys(supportedChains); // Object format with baseUrls
  }
}
