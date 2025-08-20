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
  private logger = getLogger('ExchangeAdapterFactory');

  async createAdapter(config: ExchangeConfig, enableOnlineVerification?: boolean, database?: Database): Promise<IExchangeAdapter | IBlockchainAdapter> {
    if (!config.adapterType) {
      throw new ServiceError('adapterType is required in exchange configuration', config.id, 'createAdapter');
    }

    this.logger.info(`Creating adapter for ${config.id} with type: ${config.adapterType}`);

    try {
      // Try registry-based adapter creation first
      if (ExchangeAdapterRegistry.isRegistered(config.id, config.adapterType)) {
        this.logger.debug(`Using registry-based adapter for ${config.id}:${config.adapterType}`);
        return await ExchangeAdapterRegistry.createAdapter(
          config.id,
          config.adapterType,
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

      // If we get here, the adapter type is not supported
      throw new ServiceError(
        `Unsupported adapter configuration: ${config.id}:${config.adapterType}. Available adapters: ${ExchangeAdapterRegistry.getSupportedTypes(config.id).join(', ')}`,
        config.id,
        'createAdapter'
      );
    } catch (error) {
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


  private createCCXTAdapter(config: ExchangeConfig, enableOnlineVerification?: boolean): IExchangeAdapter {
    this.logger.info(`Creating CCXT adapter for ${config.id}`);

    const ccxtId = config.id;

    if (!ccxt[ccxtId as keyof typeof ccxt]) {
      throw new ServiceError(`CCXT exchange ${ccxtId} not found`, config.id, 'createCCXTAdapter');
    }

    // Create CCXT exchange instance
    const ExchangeClass = ccxt[ccxtId as keyof typeof ccxt] as any;
    const ccxtOptions: any = {
      apiKey: config.credentials.apiKey,
      secret: config.credentials.secret,
      enableRateLimit: config.options?.enableRateLimit ?? true,
      rateLimit: config.options?.rateLimit,
      ...config.options,
    };

    // Handle passphrase/password mapping for different exchanges
    if (config.id === 'kucoin') {
      // KuCoin uses 'password' field for passphrase in CCXT, but our config stores it as 'passphrase'
      if (config.credentials.passphrase) {
        ccxtOptions.password = config.credentials.passphrase;
      } else if (config.credentials.password) {
        ccxtOptions.password = config.credentials.password;
      }
    } else {
      // Most other exchanges use 'passphrase'
      if (config.credentials.passphrase) {
        ccxtOptions.passphrase = config.credentials.passphrase;
      }
    }

    const exchange = new ExchangeClass(ccxtOptions);
    return new CCXTAdapter(exchange, config, enableOnlineVerification);
  }
} 