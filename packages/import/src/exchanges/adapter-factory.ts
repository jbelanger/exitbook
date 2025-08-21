// Factory for creating different types of exchange adapters
// @ts-ignore - CCXT types compatibility
import ccxt from 'ccxt';
import type { IBlockchainAdapter, IExchangeAdapter } from '@crypto/core';
import { ServiceError } from '@crypto/core';
import type { ExchangeConfig } from './types.ts';
import type { Database } from '@crypto/data';
import { getLogger } from '@crypto/shared-logger';
import { CCXTAdapter } from './ccxt-adapter.ts';
import { CoinbaseCCXTAdapter } from './coinbase/ccxt-adapter.ts';
import { KrakenCSVAdapter } from './kraken/csv-adapter.ts';
import { KuCoinCSVAdapter } from './kucoin/csv-adapter.ts';
import { LedgerLiveCSVAdapter } from './ledgerlive/csv-adapter.ts';

export class ExchangeAdapterFactory {
  private logger = getLogger('ExchangeAdapterFactory');

  /**
   * Create adapter with direct credentials (new simplified approach)
   */
  async createAdapterWithCredentials(
    exchangeId: string,
    adapterType: 'ccxt' | 'csv',
    options: {
      credentials?: {
        apiKey: string;
        secret: string;
        password?: string;
        sandbox?: boolean;
      };
      csvDirectories?: string[];
      enableOnlineVerification?: boolean;
    }
  ): Promise<IExchangeAdapter> {
    this.logger.info(`Creating adapter for ${exchangeId} with type: ${adapterType}`);

    if (adapterType === 'csv') {
      if (!options.csvDirectories || options.csvDirectories.length === 0) {
        throw new ServiceError('CSV directories required for CSV adapter', exchangeId, 'createAdapterWithCredentials');
      }

      switch (exchangeId.toLowerCase()) {
        case 'kraken':
          return new KrakenCSVAdapter({ csvDirectories: options.csvDirectories });
        case 'kucoin':
          return new KuCoinCSVAdapter({ csvDirectories: options.csvDirectories });
        case 'ledgerlive':
          return new LedgerLiveCSVAdapter({ csvDirectories: options.csvDirectories });
        default:
          throw new ServiceError(`Unsupported CSV exchange: ${exchangeId}`, exchangeId, 'createAdapterWithCredentials');
      }
    } else if (adapterType === 'ccxt') {
      if (!options.credentials) {
        throw new ServiceError('Credentials required for CCXT adapter', exchangeId, 'createAdapterWithCredentials');
      }

      switch (exchangeId.toLowerCase()) {
        case 'coinbase':
          if (!options.credentials.password) {
            throw new ServiceError('Password is required for Coinbase', exchangeId, 'createAdapterWithCredentials');
          }
          return new CoinbaseCCXTAdapter(options.credentials as { apiKey: string; secret: string; password: string; sandbox?: boolean }, { enableOnlineVerification: options.enableOnlineVerification });
        default:
          return this.createGenericCCXTAdapter(exchangeId, options.credentials, options.enableOnlineVerification);
      }
    }

    throw new ServiceError(`Unsupported adapter type: ${adapterType}`, exchangeId, 'createAdapterWithCredentials');
  }

  async createAdapter(config: ExchangeConfig, enableOnlineVerification?: boolean, database?: Database): Promise<IExchangeAdapter | IBlockchainAdapter> {
    if (!config.adapterType) {
      throw new ServiceError('adapterType is required in exchange configuration', config.id, 'createAdapter');
    }

    this.logger.info(`Creating adapter for ${config.id} with type: ${config.adapterType}`);

    try {
      if (config.id === 'kucoin' && config.adapterType === 'csv') {
        return this.createKuCoinAdapter(config);
      }

      if (config.id === 'kraken' && config.adapterType === 'csv') {
        return this.createKrakenCSVAdapter(config);
      }

      if (config.id === 'ledgerlive' && config.adapterType === 'csv') {
        return this.createLedgerLiveCSVAdapter(config);
      }

      if (config.id === 'coinbase' && config.adapterType === 'ccxt') {
        return new CoinbaseCCXTAdapter(config, enableOnlineVerification);
      }

      return this.createCCXTAdapter(config, enableOnlineVerification);
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

  private createKuCoinAdapter(config: ExchangeConfig): IExchangeAdapter {
    const csvDirectories = config.options?.csvDirectories;

    if (!csvDirectories || csvDirectories.length === 0) {
      throw new ServiceError('CSV directories required for CSV adapter (use csvDirectories array)', config.id, 'createKuCoinAdapter');
    }
    return new KuCoinCSVAdapter({
      csvDirectories,
      uid: config.options?.uid
    });
  }

  private createKrakenCSVAdapter(config: ExchangeConfig): IExchangeAdapter {
    const csvDirectories = config.options?.csvDirectories;

    if (!csvDirectories || csvDirectories.length === 0) {
      throw new ServiceError('CSV directories required for CSV adapter (use csvDirectories array)', config.id, 'createKrakenCSVAdapter');
    }

    return new KrakenCSVAdapter({
      csvDirectories
    });
  }

  private createLedgerLiveCSVAdapter(config: ExchangeConfig): IExchangeAdapter {
    const csvDirectories = config.options?.csvDirectories;

    if (!csvDirectories || csvDirectories.length === 0) {
      throw new ServiceError('CSV directories required for CSV adapter (use csvDirectories array)', config.id, 'createLedgerLiveCSVAdapter');
    }

    return new LedgerLiveCSVAdapter({
      csvDirectories
    });
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

  private createGenericCCXTAdapter(
    exchangeId: string,
    credentials: { apiKey: string; secret: string; password?: string; sandbox?: boolean },
    enableOnlineVerification?: boolean
  ): IExchangeAdapter {
    this.logger.info(`Creating generic CCXT adapter for ${exchangeId}`);

    if (!ccxt[exchangeId as keyof typeof ccxt]) {
      throw new ServiceError(`CCXT exchange ${exchangeId} not found`, exchangeId, 'createGenericCCXTAdapter');
    }

    // Create CCXT exchange instance
    const ExchangeClass = ccxt[exchangeId as keyof typeof ccxt] as any;
    const ccxtOptions: any = {
      apiKey: credentials.apiKey,
      secret: credentials.secret,
      enableRateLimit: true,
      rateLimit: 1000,
      sandbox: credentials.sandbox || false,
    };

    // Handle passphrase/password mapping for different exchanges
    if (exchangeId === 'kucoin') {
      // KuCoin uses 'password' field for passphrase in CCXT
      if (credentials.password) {
        ccxtOptions.password = credentials.password;
      }
    } else {
      // Most other exchanges use 'passphrase'
      if (credentials.password) {
        ccxtOptions.passphrase = credentials.password;
      }
    }

    const exchange = new ExchangeClass(ccxtOptions);
    
    // Create a minimal config for backward compatibility
    const config: ExchangeConfig = {
      id: exchangeId,
      enabled: true,
      adapterType: 'ccxt',
      credentials: {
        apiKey: credentials.apiKey,
        secret: credentials.secret,
        password: credentials.password,
        sandbox: credentials.sandbox
      }
    };
    
    return new CCXTAdapter(exchange, config, enableOnlineVerification);
  }
} 