/**
 * Factory for creating blockchain provider instances from registry metadata and config.
 *
 * Consolidates the metadata → API key check → baseUrl resolution → config building → instantiation
 * pipeline that was previously duplicated across autoRegisterFromRegistry and handleOverrideConfig
 * in BlockchainProviderManager.
 */

import type { Result } from '@exitbook/foundation';
import { ok, wrapError } from '@exitbook/foundation';
import type { HttpClientHooks } from '@exitbook/http';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector } from '@exitbook/observability';

import type { BlockchainExplorersConfig, ProviderOverride } from '../../catalog/explorer-config.js';
import type { IBlockchainProvider, ProviderCreateConfig, ProviderMetadata } from '../../contracts/index.js';
import { buildProviderNotFoundError, validateProviderApiKey } from '../manager/provider-registration-support.js';

import type { ProviderRegistry } from './provider-registry.js';

const logger = getLogger('ProviderInstanceFactory');

/**
 * Runtime context injected during manager construction (instrumentation, event bus hooks).
 */
interface ProviderCreationContext {
  instrumentation?: InstrumentationCollector | undefined;
  buildHttpClientHooks?: ((blockchain: string, providerName: string) => HttpClientHooks) | undefined;
}

/**
 * Result of creating a set of providers for a blockchain
 */
interface ProviderSetResult {
  providers: IBlockchainProvider[];
  preferredProviderName?: string | undefined;
}

export class ProviderInstanceFactory {
  private context: ProviderCreationContext = {};

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly explorerConfig?: BlockchainExplorersConfig | undefined
  ) {}

  /**
   * Update runtime context (instrumentation, hooks).
   * Called by the manager during construction.
   */
  setContext(context: ProviderCreationContext): void {
    this.context = context;
  }

  /**
   * Create provider instances for a blockchain, choosing the config or registry path.
   *
   * This is the main entry point — BlockchainProviderManager delegates here
   * after checking its own provider cache.
   */
  createProvidersForBlockchain(blockchain: string, preferredProvider?: string): ProviderSetResult {
    if (!this.explorerConfig) {
      logger.info(`No configuration file found. Using all registered providers for ${blockchain}`);
      return this.createFromRegistry(blockchain, preferredProvider);
    }

    const blockchainConfig = this.explorerConfig[blockchain];

    if (!blockchainConfig) {
      logger.info(`No configuration found for blockchain: ${blockchain}. Using all registered providers.`);
      return this.createFromRegistry(blockchain, preferredProvider);
    }

    return this.createFromOverrideConfig(blockchain, preferredProvider, blockchainConfig);
  }

  // ---------------------------------------------------------------------------
  // Config paths
  // ---------------------------------------------------------------------------

  /**
   * Create providers from registry (no config file or no blockchain entry)
   */
  private createFromRegistry(blockchain: string, preferredProvider?: string): ProviderSetResult {
    const registeredProviders = this.registry.getAvailable(blockchain);
    const availableProviderNames = registeredProviders.map((provider) => provider.name);

    this.validatePreferredProvider(blockchain, preferredProvider, availableProviderNames);

    const providers: IBlockchainProvider[] = [];

    for (const [index, providerInfo] of registeredProviders.entries()) {
      const result = this.createInstance(blockchain, providerInfo.name, index + 1);
      if (result.isErr()) {
        logger.warn({ error: result.error }, `Failed to create provider ${providerInfo.name} for ${blockchain}`);
        continue;
      }
      if (result.value !== undefined) {
        providers.push(result.value);
      }
    }

    if (providers.length > 0) {
      logger.info(
        `Auto-registered ${providers.length} providers from registry for ${blockchain}: ${providers.map((p) => p.name).join(', ')}`
      );
    } else {
      logger.warn(`No suitable providers found for ${blockchain}`);
    }

    return { providers, preferredProviderName: preferredProvider };
  }

  /**
   * Create providers from override-based config
   */
  private createFromOverrideConfig(
    blockchain: string,
    preferredProvider: string | undefined,
    config: {
      defaultEnabled?: string[] | undefined;
      overrides?: Record<string, ProviderOverride> | undefined;
    }
  ): ProviderSetResult {
    const registeredProviders = this.registry.getAvailable(blockchain);
    const availableProviderNames = registeredProviders.map((provider) => provider.name);
    const availableProviderNameSet = new Set(availableProviderNames);

    this.validatePreferredProvider(blockchain, preferredProvider, availableProviderNames);

    const defaultEnabled = config.defaultEnabled ?? availableProviderNames;
    const overrides = config.overrides ?? {};

    // Build ordered list of providers to create
    const providerCreationPlan: { name: string; override: ProviderOverride; priority: number }[] = [];

    for (const name of defaultEnabled) {
      if (!availableProviderNameSet.has(name)) {
        logger.warn(`Default provider '${name}' not registered for ${blockchain}. Skipping.`);
        continue;
      }

      const override = overrides[name] ?? {};

      if (override.enabled === false) {
        logger.debug(`Provider '${name}' disabled via config override for ${blockchain}`);
        continue;
      }

      providerCreationPlan.push({
        name,
        override,
        priority: override.priority ?? providerCreationPlan.length + 1,
      });
    }

    providerCreationPlan.sort((a, b) => a.priority - b.priority);

    const providers: IBlockchainProvider[] = [];

    for (const providerPlanEntry of providerCreationPlan) {
      const result = this.createInstance(
        blockchain,
        providerPlanEntry.name,
        providerPlanEntry.priority,
        providerPlanEntry.override
      );
      if (result.isErr()) {
        logger.warn({ error: result.error }, `Failed to create provider ${providerPlanEntry.name} for ${blockchain}`);
        continue;
      }
      if (result.value !== undefined) {
        providers.push(result.value);
      }
    }

    if (providers.length > 0) {
      logger.info(
        `Auto-registered ${providers.length} providers for ${blockchain}: ${providers.map((p) => p.name).join(', ')}`
      );
    } else {
      logger.warn(`No suitable providers found for ${blockchain}`);
    }

    return { providers, preferredProviderName: preferredProvider };
  }

  // ---------------------------------------------------------------------------
  // Core instance creation (deduplicated pipeline)
  // ---------------------------------------------------------------------------

  /**
   * Create a single provider instance.
   *
   * Shared by both config paths — metadata lookup, API key validation,
   * baseUrl resolution, config building, and registry instantiation.
   */
  private createInstance(
    blockchain: string,
    providerName: string,
    priority: number,
    override?: ProviderOverride
  ): Result<IBlockchainProvider | undefined, Error> {
    try {
      const metadata = this.registry.getMetadata(blockchain, providerName);
      if (!metadata) {
        logger.warn(`No metadata found for provider ${providerName}. Skipping.`);
        return ok(undefined);
      }

      const apiKey = this.resolveApiKey(metadata);
      if (metadata.requiresApiKey) {
        const validation = validateProviderApiKey(metadata, apiKey);
        if (!validation.available) {
          logger.warn(
            `No API key found for ${metadata.displayName}. Set environment variable: ${validation.envVar}. Skipping provider.`
          );
          return ok(undefined);
        }
      }

      const baseUrl = this.resolveBaseUrl(metadata, blockchain);
      const config = this.buildConfig(metadata, blockchain, baseUrl, priority, override, apiKey);
      const provider = this.registry.createProvider(blockchain, providerName, config);

      logger.debug(
        `Created provider ${providerName} for ${blockchain} - Priority: ${priority}, BaseUrl: ${baseUrl}, RequiresApiKey: ${metadata.requiresApiKey}`
      );

      return ok(provider);
    } catch (error) {
      return wrapError(error, `Failed to create provider ${providerName} for ${blockchain}`);
    }
  }

  /**
   * Resolve chain-specific baseUrl from metadata.
   * Object-format supportedChains can override the default baseUrl per chain.
   */
  private resolveBaseUrl(metadata: ProviderMetadata, blockchain: string): string {
    if (metadata.supportedChains && !Array.isArray(metadata.supportedChains)) {
      const chainConfig = metadata.supportedChains[blockchain];
      if (chainConfig?.baseUrl) {
        return chainConfig.baseUrl;
      }
    }
    return metadata.baseUrl;
  }

  /**
   * Build provider creation config from metadata, priority, and optional overrides.
   */
  private buildConfig(
    metadata: ProviderMetadata,
    blockchain: string,
    baseUrl: string,
    priority: number,
    override: ProviderOverride | undefined,
    apiKey?: string
  ): ProviderCreateConfig {
    const overrideRateLimit = override?.rateLimit;

    return {
      apiKey,
      baseUrl,
      blockchain,
      displayName: metadata.displayName,
      enabled: true,
      instrumentation: this.context.instrumentation,
      name: metadata.name,
      priority,
      rateLimit: {
        burstLimit: overrideRateLimit?.burstLimit ?? metadata.defaultConfig.rateLimit.burstLimit,
        requestsPerHour: overrideRateLimit?.requestsPerHour ?? metadata.defaultConfig.rateLimit.requestsPerHour,
        requestsPerMinute: overrideRateLimit?.requestsPerMinute ?? metadata.defaultConfig.rateLimit.requestsPerMinute,
        requestsPerSecond: overrideRateLimit?.requestsPerSecond ?? metadata.defaultConfig.rateLimit.requestsPerSecond,
      },
      requestHooks: this.context.buildHttpClientHooks?.(blockchain, metadata.name),
      requiresApiKey: metadata.requiresApiKey,
      retries: override?.retries ?? metadata.defaultConfig.retries,
      timeout: override?.timeout ?? metadata.defaultConfig.timeout,
    };
  }

  private resolveApiKey(metadata: Pick<ProviderMetadata, 'apiKeyEnvVar' | 'name'>): string | undefined {
    const envVar = metadata.apiKeyEnvVar || `${metadata.name.toUpperCase().replace(/-/g, '_')}_API_KEY`;
    const apiKey = process.env[envVar];
    return apiKey && apiKey !== 'YourApiKeyToken' ? apiKey : undefined;
  }

  private validatePreferredProvider(
    blockchain: string,
    preferredProvider: string | undefined,
    availableProviderNames: string[]
  ): void {
    if (!preferredProvider) {
      return;
    }

    if (!availableProviderNames.includes(preferredProvider)) {
      throw new Error(buildProviderNotFoundError(blockchain, preferredProvider, availableProviderNames));
    }

    logger.info(
      `Preferred provider: ${preferredProvider} for ${blockchain} (will be used exclusively if it supports the operation, otherwise failover to others)`
    );
  }
}
