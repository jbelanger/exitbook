import type {
  IUniversalAdapter,
  UniversalAdapterConfig,
  UniversalBlockchainAdapterConfig,
  UniversalExchangeAdapterConfig,
} from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
// Import exchange adapters directly
import type { BlockchainExplorersConfig } from '@crypto/shared-utils';

// Import specific adapters directly
import { AvalancheAdapter } from '../../blockchains/avalanche/adapter.ts';
import { BitcoinAdapter } from '../../blockchains/bitcoin/adapter.ts';
import { EthereumAdapter } from '../../blockchains/ethereum/adapter.ts';
import { InjectiveAdapter } from '../../blockchains/injective/adapter.ts';
import { SubstrateAdapter } from '../../blockchains/polkadot/adapter.ts';
// Ensure blockchain providers are registered
import '../../blockchains/registry/register-providers.ts';
import { SolanaAdapter } from '../../blockchains/solana/adapter.ts';
import { CoinbaseCCXTAdapter } from '../../exchanges/coinbase/ccxt-adapter.ts';
import { KrakenCSVAdapter } from '../../exchanges/kraken/csv-adapter.ts';
import { KuCoinCSVAdapter } from '../../exchanges/kucoin/csv-adapter.ts';
import { LedgerLiveCSVAdapter } from '../../exchanges/ledgerlive/csv-adapter.ts';

/**
 * Universal adapter factory that creates adapters implementing the IUniversalAdapter interface.
 *
 * During the migration phase, this factory uses bridge adapters to wrap existing
 * IExchangeAdapter and IBlockchainAdapter implementations. This allows the new
 * unified interface to work with existing adapter implementations without modification.
 */
export class UniversalAdapterFactory {
  private static readonly logger = getLogger('UniversalAdapterFactory');

  /**
   * Create a single universal adapter based on configuration
   */
  static async create(
    config: UniversalAdapterConfig,
    explorerConfig?: BlockchainExplorersConfig | null
  ): Promise<IUniversalAdapter> {
    this.logger.info(`Creating universal adapter for ${config.id} (type: ${config.type})`);

    if (config.type === 'exchange') {
      return this.createExchangeAdapter(config as UniversalExchangeAdapterConfig);
    }

    if (config.type === 'blockchain') {
      return this.createBlockchainAdapter(config as UniversalBlockchainAdapterConfig, explorerConfig);
    }

    throw new Error(`Unsupported adapter type: ${(config as UniversalAdapterConfig).type}`);
  }

  /**
   * Create a blockchain adapter directly (no more bridge adapters)
   */
  private static async createBlockchainAdapter(
    config: UniversalBlockchainAdapterConfig,
    explorerConfig?: BlockchainExplorersConfig | null
  ): Promise<IUniversalAdapter> {
    this.logger.debug(`Creating blockchain adapter for ${config.id} with network: ${config.network}`);

    // Pass null instead of undefined to indicate that config is optional
    const resolvedConfig = explorerConfig === undefined ? null : explorerConfig;

    // Create the specific blockchain adapter directly
    switch (config.id.toLowerCase()) {
      case 'bitcoin':
        return new BitcoinAdapter(config, resolvedConfig);
      case 'ethereum':
        return new EthereumAdapter(config, resolvedConfig);
      case 'solana':
        return new SolanaAdapter(config, resolvedConfig);
      case 'avalanche':
        return new AvalancheAdapter(config, resolvedConfig);
      case 'injective':
        return new InjectiveAdapter(config, resolvedConfig);
      case 'polkadot':
        return new SubstrateAdapter(config, resolvedConfig);
      default:
        throw new Error(`Unsupported blockchain: ${config.id}`);
    }
  }

  /**
   * Helper method to create blockchain adapter configuration
   */
  static createBlockchainConfig(
    blockchain: string,
    network: string = 'mainnet',
    subType: 'rest' | 'rpc' = 'rest'
  ): UniversalBlockchainAdapterConfig {
    return {
      id: blockchain,
      network,
      subType,
      type: 'blockchain',
    };
  }

  /**
   * Create CCXT exchange adapter directly
   */
  private static async createCCXTExchangeAdapter(config: UniversalExchangeAdapterConfig): Promise<IUniversalAdapter> {
    if (!config.credentials) {
      throw new Error('Credentials required for CCXT exchange adapters');
    }

    switch (config.id.toLowerCase()) {
      case 'coinbase':
        return new CoinbaseCCXTAdapter(
          {
            apiKey: config.credentials.apiKey,
            passphrase: config.credentials.password || '',
            sandbox: false,
            secret: config.credentials.secret,
          },
          { enableOnlineVerification: true }
        );
      default:
        throw new Error(`Unsupported CCXT exchange: ${config.id}`);
    }
  }

  /**
   * Create CSV exchange adapter directly
   */
  private static async createCSVExchangeAdapter(config: UniversalExchangeAdapterConfig): Promise<IUniversalAdapter> {
    if (!config.csvDirectories?.length) {
      throw new Error('CSV directories required for CSV exchange adapters');
    }

    // Create adapter config for CSV adapters
    const adapterConfig = {
      csvDirectories: config.csvDirectories,
      id: config.id,
      subType: 'csv' as const,
      type: 'exchange' as const,
    };

    switch (config.id.toLowerCase()) {
      case 'kraken':
        return new KrakenCSVAdapter(adapterConfig);
      case 'kucoin':
        return new KuCoinCSVAdapter(adapterConfig);
      case 'ledgerlive':
        return new LedgerLiveCSVAdapter(adapterConfig);
      default:
        throw new Error(`Unsupported CSV exchange: ${config.id}`);
    }
  }

  /**
   * Create an exchange adapter directly (no more bridge adapters)
   */
  private static async createExchangeAdapter(config: UniversalExchangeAdapterConfig): Promise<IUniversalAdapter> {
    this.logger.debug(`Creating exchange adapter for ${config.id} with subType: ${config.subType}`);

    if (config.subType === 'csv') {
      return this.createCSVExchangeAdapter(config);
    } else if (config.subType === 'ccxt') {
      return this.createCCXTExchangeAdapter(config);
    } else if (config.subType === 'native') {
      return this.createNativeExchangeAdapter(config);
    }

    throw new Error(`Unsupported exchange adapter subType: ${config.subType} for ${config.id}`);
  }

  /**
   * Helper method to create exchange adapter configuration
   */
  static createExchangeConfig(
    exchangeId: string,
    subType: 'ccxt' | 'csv' | 'native',
    options: {
      credentials?:
        | {
            apiKey: string;
            password?: string | undefined;
            secret: string;
          }
        | undefined;
      csvDirectories?: string[] | undefined;
    }
  ): UniversalExchangeAdapterConfig {
    return {
      credentials: options.credentials,
      csvDirectories: options.csvDirectories,
      id: exchangeId,
      subType,
      type: 'exchange',
    };
  }

  /**
   * Create multiple universal adapters from an array of configurations
   */
  static async createMany(
    configs: UniversalAdapterConfig[],
    explorerConfig?: BlockchainExplorersConfig | null
  ): Promise<IUniversalAdapter[]> {
    this.logger.info(`Creating ${configs.length} universal adapters`);

    return Promise.all(configs.map(config => this.create(config, explorerConfig)));
  }

  /**
   * Create native exchange adapter directly
   */
  private static async createNativeExchangeAdapter(config: UniversalExchangeAdapterConfig): Promise<IUniversalAdapter> {
    if (!config.credentials) {
      throw new Error('Credentials required for native exchange adapters');
    }

    switch (config.id.toLowerCase()) {
      default:
        throw new Error(`Unsupported native exchange: ${config.id}`);
    }
  }
}
