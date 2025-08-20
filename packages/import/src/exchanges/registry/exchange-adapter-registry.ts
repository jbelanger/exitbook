import type { IExchangeAdapter, IBlockchainAdapter } from '@crypto/core';
import type { ExchangeConfig } from '../types.ts';
import type {
  ExchangeAdapterFactory,
  ExchangeAdapterInfo,
  ExchangeAdapterMetadata
} from './types.ts';

/**
 * Central registry for exchange adapters
 */
export class ExchangeAdapterRegistry {
  private static adapters = new Map<string, ExchangeAdapterFactory>();

  /**
   * Register an exchange adapter with the registry
   */
  static register(factory: ExchangeAdapterFactory): void {
    const key = `${factory.metadata.exchangeId}:${factory.metadata.adapterType}`;

    if (this.adapters.has(key)) {
      throw new Error(`Exchange adapter ${key} is already registered`);
    }

    this.adapters.set(key, factory);
  }

  /**
   * Get all available adapters for an exchange
   */
  static getAvailable(exchangeId: string): ExchangeAdapterInfo[] {
    return Array.from(this.adapters.entries())
      .filter(([key]) => key.startsWith(`${exchangeId}:`))
      .map(([_, factory]) => ({
        exchangeId: factory.metadata.exchangeId,
        displayName: factory.metadata.displayName,
        adapterType: factory.metadata.adapterType,
        description: factory.metadata.description || '',
        capabilities: factory.metadata.capabilities,
        defaultConfig: factory.metadata.defaultConfig,
        configValidation: factory.metadata.configValidation
      }));
  }

  /**
   * Get all registered exchange adapters
   */
  static getAllAdapters(): ExchangeAdapterInfo[] {
    const exchanges = new Set(
      Array.from(this.adapters.keys()).map(key => key.split(':')[0])
    );

    return Array.from(exchanges)
      .filter(exchange => exchange !== undefined)
      .flatMap(exchange => this.getAvailable(exchange!));
  }

  /**
   * Create an exchange adapter instance
   */
  static async createAdapter(
    exchangeId: string,
    adapterType: 'ccxt' | 'native' | 'csv',
    config: ExchangeConfig,
    enableOnlineVerification?: boolean,
    database?: any
  ): Promise<IExchangeAdapter | IBlockchainAdapter> {
    const key = `${exchangeId}:${adapterType}`;
    const factory = this.adapters.get(key);

    if (!factory) {
      const available = this.getAvailable(exchangeId).map(a => a.adapterType);
      throw new Error(
        `Exchange adapter ${adapterType} not found for exchange ${exchangeId}. ` +
        `Available adapters: ${available.join(', ')}`
      );
    }

    return factory.create(config, enableOnlineVerification, database);
  }

  /**
   * Check if an adapter is registered
   */
  static isRegistered(exchangeId: string, adapterType: 'ccxt' | 'native' | 'csv'): boolean {
    return this.adapters.has(`${exchangeId}:${adapterType}`);
  }

  /**
   * Get adapter metadata
   */
  static getMetadata(exchangeId: string, adapterType: 'ccxt' | 'native' | 'csv'): ExchangeAdapterMetadata | null {
    const key = `${exchangeId}:${adapterType}`;
    const factory = this.adapters.get(key);
    return factory?.metadata || null;
  }

  /**
   * Validate exchange configuration against registered adapters
   */
  static validateConfig(config: ExchangeConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.id) {
      errors.push('Exchange ID is required');
      return { valid: false, errors };
    }

    if (!config.adapterType) {
      errors.push('Adapter type is required');
      return { valid: false, errors };
    }

    const availableAdapters = this.getAvailable(config.id);
    const availableTypes = availableAdapters.map(a => a.adapterType);

    if (!availableTypes.includes(config.adapterType)) {
      errors.push(
        `Unknown adapter type '${config.adapterType}' for exchange '${config.id}'. ` +
        `Available: ${availableTypes.join(', ')}`
      );
    } else {
      // Validate specific configuration requirements
      const metadata = this.getMetadata(config.id, config.adapterType);
      if (metadata?.configValidation) {
        const { requiredCredentials, requiredOptions } = metadata.configValidation;

        // Check required credentials
        for (const cred of requiredCredentials || []) {
          if (!config.credentials || !config.credentials[cred]) {
            errors.push(`Required credential '${cred}' missing for ${config.id}:${config.adapterType}`);
          }
        }

        // Check required options
        for (const opt of requiredOptions || []) {
          if (!config.options || !config.options[opt]) {
            errors.push(`Required option '${opt}' missing for ${config.id}:${config.adapterType}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get supported adapter types for an exchange
   */
  static getSupportedTypes(exchangeId: string): string[] {
    return this.getAvailable(exchangeId).map(adapter => adapter.adapterType);
  }

  /**
   * List all registered exchanges
   */
  static getRegisteredExchanges(): string[] {
    const exchanges = new Set(
      Array.from(this.adapters.keys()).map(key => key.split(':')[0])
    );
    return Array.from(exchanges).filter(exchange => exchange !== undefined) as string[];
  }
}