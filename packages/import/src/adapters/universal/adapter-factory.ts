import { ExchangeAdapterFactory } from '../../exchanges/adapter-factory.js';
import { BlockchainAdapterFactory } from '../../blockchains/shared/blockchain-adapter-factory.js';
import { ExchangeBridgeAdapter } from './exchange-bridge-adapter.js';
import { BlockchainBridgeAdapter } from './blockchain-bridge-adapter.js';
import type { IUniversalAdapter } from './types.js';
import type { AdapterConfig, ExchangeAdapterConfig, BlockchainAdapterConfig } from './config.js';
import type { BlockchainExplorersConfig } from '../../blockchains/shared/explorer-config.js';
import { getLogger } from '@crypto/shared-logger';

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
  static async create(config: AdapterConfig, explorerConfig?: BlockchainExplorersConfig): Promise<IUniversalAdapter> {
    this.logger.info(`Creating universal adapter for ${config.id} (type: ${config.type})`);

    if (config.type === 'exchange') {
      return this.createExchangeAdapter(config as ExchangeAdapterConfig);
    }
    
    if (config.type === 'blockchain') {
      return this.createBlockchainAdapter(config as BlockchainAdapterConfig, explorerConfig);
    }
    
    throw new Error(`Unsupported adapter type: ${(config as any).type}`);
  }

  /**
   * Create multiple universal adapters from an array of configurations
   */
  static async createMany(
    configs: AdapterConfig[], 
    explorerConfig?: BlockchainExplorersConfig
  ): Promise<IUniversalAdapter[]> {
    this.logger.info(`Creating ${configs.length} universal adapters`);
    
    return Promise.all(
      configs.map(config => this.create(config, explorerConfig))
    );
  }

  /**
   * Create an exchange adapter wrapped in a bridge adapter
   */
  private static async createExchangeAdapter(config: ExchangeAdapterConfig): Promise<IUniversalAdapter> {
    this.logger.debug(`Creating exchange adapter for ${config.id} with subType: ${config.subType}`);
    
    // Create the old exchange adapter using the existing factory
    const oldFactory = new ExchangeAdapterFactory();
    const oldAdapter = await oldFactory.createAdapterWithCredentials(
      config.id,
      config.subType,
      {
        credentials: config.credentials,
        csvDirectories: config.csvDirectories,
        enableOnlineVerification: false // Default to false for now
      }
    );
    
    // Wrap it in a bridge adapter to provide the universal interface
    return new ExchangeBridgeAdapter(oldAdapter, config);
  }

  /**
   * Create a blockchain adapter wrapped in a bridge adapter
   */
  private static async createBlockchainAdapter(
    config: BlockchainAdapterConfig, 
    explorerConfig?: BlockchainExplorersConfig
  ): Promise<IUniversalAdapter> {
    if (!explorerConfig) {
      throw new Error('Explorer configuration required for blockchain adapters');
    }

    this.logger.debug(`Creating blockchain adapter for ${config.id} with network: ${config.network}`);
    
    // Create the old blockchain adapter using the existing factory
    const oldFactory = new BlockchainAdapterFactory();
    const oldAdapter = await oldFactory.createBlockchainAdapter(config.id, explorerConfig);
    
    // Wrap it in a bridge adapter to provide the universal interface
    return new BlockchainBridgeAdapter(oldAdapter, config);
  }

  /**
   * Helper method to create exchange adapter configuration
   */
  static createExchangeConfig(
    exchangeId: string,
    subType: 'ccxt' | 'csv',
    options: {
      credentials?: {
        apiKey: string;
        secret: string;
        password?: string;
      };
      csvDirectories?: string[];
    }
  ): ExchangeAdapterConfig {
    return {
      type: 'exchange',
      id: exchangeId,
      subType,
      credentials: options.credentials,
      csvDirectories: options.csvDirectories
    };
  }

  /**
   * Helper method to create blockchain adapter configuration
   */
  static createBlockchainConfig(
    blockchain: string,
    network: string = 'mainnet',
    subType: 'rest' | 'rpc' = 'rest'
  ): BlockchainAdapterConfig {
    return {
      type: 'blockchain',
      id: blockchain,
      subType,
      network
    };
  }
}