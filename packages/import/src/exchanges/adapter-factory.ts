import type { IUniversalAdapter, UniversalExchangeAdapterConfig } from '@crypto/core';
import { ServiceError } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import ccxt from 'ccxt';
import { CCXTAdapter } from './ccxt-adapter.js';
import { CoinbaseCCXTAdapter } from './coinbase/ccxt-adapter.js';
import { KrakenCSVAdapter } from './kraken/csv-adapter.js';
import { KuCoinCSVAdapter } from './kucoin/csv-adapter.js';
import { LedgerLiveCSVAdapter } from './ledgerlive/csv-adapter.js';

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
  ): Promise<IUniversalAdapter> {
    this.logger.info(`Creating adapter for ${exchangeId} with type: ${adapterType}`);

    if (adapterType === 'csv') {
      if (!options.csvDirectories || options.csvDirectories.length === 0) {
        throw new ServiceError('CSV directories required for CSV adapter', exchangeId, 'createAdapterWithCredentials');
      }

      switch (exchangeId.toLowerCase()) {
        case 'kraken':
          return new KrakenCSVAdapter({
            type: 'exchange',
            id: 'kraken',
            subType: 'csv',
            csvDirectories: options.csvDirectories
          } as UniversalExchangeAdapterConfig);
        case 'kucoin':
          return new KuCoinCSVAdapter({
            type: 'exchange',
            id: 'kucoin',
            subType: 'csv',
            csvDirectories: options.csvDirectories
          } as UniversalExchangeAdapterConfig);
        case 'ledgerlive':
          return new LedgerLiveCSVAdapter({
            type: 'exchange',
            id: 'ledgerlive',
            subType: 'csv',
            csvDirectories: options.csvDirectories
          } as UniversalExchangeAdapterConfig);
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

  private createGenericCCXTAdapter(
    exchangeId: string,
    credentials: { apiKey: string; secret: string; password?: string; sandbox?: boolean },
    enableOnlineVerification?: boolean
  ): IUniversalAdapter {
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
    
    return new CCXTAdapter(exchange, exchangeId, enableOnlineVerification);
  }
} 