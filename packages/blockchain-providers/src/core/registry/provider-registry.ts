import type {
  IBlockchainProvider,
  ProviderConfig,
  ProviderCreateConfig,
  ProviderFactory,
  ProviderInfo,
  ProviderMetadata,
} from '../types/index.js';

function toProviderInfo(metadata: ProviderMetadata): ProviderInfo {
  return {
    blockchain: metadata.blockchain,
    capabilities: metadata.capabilities,
    defaultConfig: metadata.defaultConfig,
    description: metadata.description,
    displayName: metadata.displayName,
    name: metadata.name,
    requiresApiKey: metadata.requiresApiKey ?? false,
  };
}

function getSupportedChains(metadata: ProviderMetadata): string[] {
  const { supportedChains, blockchain } = metadata;

  if (!supportedChains) {
    return [blockchain];
  }

  if (Array.isArray(supportedChains)) {
    return supportedChains;
  }

  return Object.keys(supportedChains);
}

/**
 * Central registry for blockchain providers.
 *
 * Always used as an instance — create via `new ProviderRegistry()` or
 * the higher-level `createProviderRegistry()` helper.
 */
export class ProviderRegistry {
  private providers = new Map<string, ProviderFactory>();

  // ---------------------------------------------------------------------------
  // Instance methods (the real implementation)
  // ---------------------------------------------------------------------------

  /**
   * Create a provider instance.
   * Supports multi-chain providers via supportedChains metadata.
   */
  createProvider(blockchain: string, name: string, config: ProviderCreateConfig): IBlockchainProvider {
    const factory = this.findFactory(blockchain, name);

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

    if (config.metadata && config.metadata.name !== factory.metadata.name) {
      throw new Error(
        `Provider config metadata mismatch for '${name}' on '${blockchain}'. ` +
          `Expected metadata for '${factory.metadata.name}', got '${config.metadata.name}'.`
      );
    }

    const resolvedConfig: ProviderConfig = {
      ...config,
      metadata: factory.metadata,
    };

    return factory.create(resolvedConfig);
  }

  /**
   * Check if any providers are registered
   */
  hasAnyProviders(): boolean {
    return this.providers.size > 0;
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ProviderInfo[] {
    const uniqueProviders = new Map<string, ProviderInfo>();

    for (const factory of this.providers.values()) {
      uniqueProviders.set(factory.metadata.name, toProviderInfo(factory.metadata));
    }

    return Array.from(uniqueProviders.values());
  }

  /**
   * Get all available providers for a blockchain.
   * Supports multi-chain providers via supportedChains metadata.
   */
  getAvailable(blockchain: string): ProviderInfo[] {
    return Array.from(this.providers.values())
      .filter((factory) => getSupportedChains(factory.metadata).includes(blockchain))
      .map((factory) => toProviderInfo(factory.metadata));
  }

  /**
   * Get provider metadata.
   * Supports multi-chain providers via supportedChains metadata.
   */
  getMetadata(blockchain: string, name: string): ProviderMetadata | undefined {
    return this.findFactory(blockchain, name)?.metadata;
  }

  /**
   * Check if a provider is registered.
   * Supports multi-chain providers via supportedChains metadata.
   */
  isRegistered(blockchain: string, name: string): boolean {
    return this.findFactory(blockchain, name) !== undefined;
  }

  /**
   * Register a provider with the registry
   */
  register(factory: ProviderFactory): void {
    const key = `${factory.metadata.blockchain}:${factory.metadata.name}`;

    if (this.providers.has(key)) {
      throw new Error(`Provider ${key} is already registered`);
    }

    this.providers.set(key, factory);
  }

  /**
   * Create a default ProviderConfig from metadata.
   * Useful for tests and manual provider instantiation.
   * Automatically applies chain-specific baseUrl from supportedChains object format.
   */
  createDefaultConfig(blockchain: string, name: string): ProviderConfig {
    const metadata = this.getMetadata(blockchain, name);
    if (!metadata) {
      throw new Error(`Provider '${name}' not found for blockchain '${blockchain}'`);
    }

    let baseUrl = metadata.baseUrl;

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
      metadata,
      name: metadata.name,
      priority: 1,
      rateLimit: metadata.defaultConfig.rateLimit,
      requiresApiKey: metadata.requiresApiKey,
      retries: metadata.defaultConfig.retries,
      timeout: metadata.defaultConfig.timeout,
    };
  }

  /**
   * Validate provider configuration against registered providers.
   * Supports both legacy (explorers array) and new (override-based) formats.
   */
  validateConfig(config: Record<string, unknown>): {
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

      const availableNames = this.getAvailable(blockchain).map((provider) => provider.name);
      const availableNameSet = new Set(availableNames);
      const availableNamesText = availableNames.join(', ');
      const addUnknownProviderError = (providerName: string, section: 'defaultEnabled' | 'explorers' | 'overrides') =>
        errors.push(
          `Unknown provider '${providerName}' in ${section} for blockchain '${blockchain}'. Available: ${availableNamesText}`
        );

      if (configObj.explorers) {
        for (const explorer of configObj.explorers) {
          const explorerObj = explorer as { name?: string };
          if (!explorerObj.name) {
            errors.push(`Missing name for explorer in blockchain ${blockchain}`);
            continue;
          }

          if (!availableNameSet.has(explorerObj.name)) {
            addUnknownProviderError(explorerObj.name, 'explorers');
          }
        }
      }

      if (configObj.defaultEnabled) {
        for (const providerName of configObj.defaultEnabled) {
          if (!availableNameSet.has(providerName)) {
            addUnknownProviderError(providerName, 'defaultEnabled');
          }
        }
      }

      if (configObj.overrides) {
        for (const providerName of Object.keys(configObj.overrides)) {
          if (!availableNameSet.has(providerName)) {
            addUnknownProviderError(providerName, 'overrides');
          }
        }
      }
    }

    return {
      errors,
      valid: errors.length === 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private findFactory(blockchain: string, name: string): ProviderFactory | undefined {
    const exactKey = `${blockchain}:${name}`;
    const factory = this.providers.get(exactKey);
    if (factory) return factory;

    return Array.from(this.providers.values()).find((f) => {
      const chains = getSupportedChains(f.metadata);
      return f.metadata.name === name && chains.includes(blockchain);
    });
  }
}
