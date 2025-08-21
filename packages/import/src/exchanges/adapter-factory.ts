// Factory for creating different types of exchange adapters
// @ts-ignore - CCXT types compatibility
import { IBlockchainAdapter, IExchangeAdapter, ServiceError } from '@crypto/core';
import type { ExchangeConfig } from './types.ts';
import { Database } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';
import ccxt from 'ccxt';
import { CCXTAdapter } from './ccxt-adapter.ts';
import { ExchangeAdapterRegistry } from './registry/index.ts';
// Import to trigger adapter registration
import './registry/register-adapters.ts';




export class ExchangeAdapterFactory {
  private readonly logger = getLogger('ExchangeAdapterFactory');

  async createAdapter(
    exchangeConfig: ExchangeConfig, 
    enableOnlineVerification?: boolean, 
    database?: Database
  ): Promise<IExchangeAdapter | IBlockchainAdapter> {
    this.validateConfiguration(exchangeConfig);
    
    this.logger.info(`Creating adapter for ${exchangeConfig.id} with type: ${exchangeConfig.adapterType}`);

    try {
      return await this.createAdapterByType(exchangeConfig, enableOnlineVerification, database);
    } catch (error) {
      return this.handleAdapterCreationError(error, exchangeConfig);
    }
  }


  private validateConfiguration(config: ExchangeConfig): void {
    if (!config.adapterType) {
      throw new ServiceError('adapterType is required in exchange configuration', config.id, 'createAdapter');
    }
  }

  private async createAdapterByType(
    config: ExchangeConfig, 
    enableOnlineVerification?: boolean, 
    database?: Database
  ): Promise<IExchangeAdapter | IBlockchainAdapter> {
    // Try registry-based adapter creation first
    if (ExchangeAdapterRegistry.isRegistered(config.id, config.adapterType!)) {
      this.logger.debug(`Using registry-based adapter for ${config.id}:${config.adapterType}`);
      return await ExchangeAdapterRegistry.createAdapter(
        config.id,
        config.adapterType!,
        config,
        enableOnlineVerification,
        database
      );
    }

    // For CCXT adapters that aren't specifically registered, use the generic CCXT adapter
    if (config.adapterType === 'ccxt') {
      this.logger.debug(`Using generic CCXT adapter for ${config.id}`);
      return this.createCCXTAdapter(config, enableOnlineVerification);
    }

    throw new ServiceError(
      `Unsupported adapter configuration: ${config.id}:${config.adapterType}. Available adapters: ${ExchangeAdapterRegistry.getSupportedTypes(config.id).join(', ')}`,
      config.id,
      'createAdapter'
    );
  }

  private createCCXTAdapter(config: ExchangeConfig, enableOnlineVerification?: boolean): IExchangeAdapter {
    this.logger.info(`Creating CCXT adapter for ${config.id}`);
    
    this.validateCCXTExchange(config.id);
    
    const ExchangeClass = ccxt[config.id as keyof typeof ccxt] as any;
    const ccxtOptions = this.buildCCXTOptions(config);
    
    const exchangeInstance = new ExchangeClass(ccxtOptions);
    return new CCXTAdapter(exchangeInstance, config, enableOnlineVerification);
  }

  private validateCCXTExchange(exchangeId: string): void {
    if (!ccxt[exchangeId as keyof typeof ccxt]) {
      throw new ServiceError(`CCXT exchange ${exchangeId} not found`, exchangeId, 'createCCXTAdapter');
    }
  }

  private buildCCXTOptions(config: ExchangeConfig): any {
    const baseOptions = {
      apiKey: config.credentials.apiKey,
      secret: config.credentials.secret,
      enableRateLimit: config.options?.enableRateLimit ?? true,
      rateLimit: config.options?.rateLimit,
      ...config.options,
    };

    return this.addExchangeSpecificCredentials(baseOptions, config);
  }

  private addExchangeSpecificCredentials(options: any, config: ExchangeConfig): any {
    // KuCoin uses 'password' field for passphrase in CCXT
    if (config.id === 'kucoin') {
      if (config.credentials.passphrase) {
        options.password = config.credentials.passphrase;
      } else if (config.credentials.password) {
        options.password = config.credentials.password;
      }
    } else {
      // Most other exchanges use 'passphrase'
      if (config.credentials.passphrase) {
        options.passphrase = config.credentials.passphrase;
      }
    }

    return options;
  }

  private handleAdapterCreationError(error: unknown, config: ExchangeConfig): never {
    this.logger.error(`Failed to create adapter for ${config.id} - Error: ${error}`);

    if (error instanceof ServiceError) {
      throw error;
    }

    throw new ServiceError(
      `Failed to create adapter: ${error instanceof Error ? error.message : 'Unknown error'}`,
      config.id,
      'createAdapter',
      error instanceof Error ? error : undefined
    );
  }
} 