import { getLogger } from '@crypto/shared-logger';

import type { ETLComponentConfig } from '../common/interfaces.ts';
import type { IImporter } from './interfaces.ts';

/**
 * Factory for creating importer instances.
 * Handles dependency injection and adapter-specific instantiation.
 */
export class ImporterFactory {
  private static readonly logger = getLogger('ImporterFactory');

  /**
   * Create an importer for the specified adapter.
   */
  static async create<T>(config: ETLComponentConfig): Promise<IImporter<T>> {
    const { adapterId, adapterType } = config;

    ImporterFactory.logger.info(`Creating importer for ${adapterId} (type: ${adapterType})`);

    if (adapterType === 'exchange') {
      return await ImporterFactory.createExchangeImporter<T>(config);
    }

    if (adapterType === 'blockchain') {
      return await ImporterFactory.createBlockchainImporter<T>(config);
    }

    throw new Error(`Unsupported adapter type: ${adapterType}`);
  }

  /**
   * Create Avalanche importer.
   */
  private static async createAvalancheImporter<T>(config: ETLComponentConfig): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { AvalancheTransactionImporter } = await import('../../blockchains/avalanche/transaction-importer.ts');
    return new AvalancheTransactionImporter(config.dependencies) as unknown as IImporter<T>;
  }

  /**
   * Create Bitcoin importer.
   */
  private static async createBitcoinImporter<T>(config: ETLComponentConfig): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { BitcoinTransactionImporter } = await import('../../blockchains/bitcoin/transaction-importer.ts');
    return new BitcoinTransactionImporter(config.dependencies) as unknown as IImporter<T>;
  }

  /**
   * Create a blockchain importer.
   */
  private static async createBlockchainImporter<T>(config: ETLComponentConfig): Promise<IImporter<T>> {
    const { adapterId, dependencies } = config;

    if (!dependencies.providerManager) {
      throw new Error(`Provider manager required for blockchain importer: ${adapterId}`);
    }

    switch (adapterId.toLowerCase()) {
      case 'bitcoin':
        return await ImporterFactory.createBitcoinImporter<T>(config);

      case 'ethereum':
        return await ImporterFactory.createEthereumImporter<T>(config);

      case 'injective':
        return await ImporterFactory.createInjectiveImporter<T>(config);

      case 'solana':
        return await ImporterFactory.createSolanaImporter<T>(config);

      case 'avalanche':
        return await ImporterFactory.createAvalancheImporter<T>(config);

      default:
        throw new Error(`Unsupported blockchain importer: ${adapterId}`);
    }
  }

  /**
   * Create Coinbase importer - placeholder for future implementation.
   */
  private static async createCoinbaseImporter<T>(_config: ETLComponentConfig): Promise<IImporter<T>> {
    throw new Error('CoinbaseImporter not yet implemented');
  }

  /**
   * Create Ethereum importer.
   */
  private static async createEthereumImporter<T>(config: ETLComponentConfig): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { EthereumTransactionImporter } = await import('../../blockchains/ethereum/transaction-importer.ts');
    return new EthereumTransactionImporter(config.dependencies) as unknown as IImporter<T>;
  }

  /**
   * Create an exchange importer.
   */
  private static async createExchangeImporter<T>(config: ETLComponentConfig): Promise<IImporter<T>> {
    const { adapterId } = config;

    switch (adapterId.toLowerCase()) {
      case 'kraken':
        // Dynamic import to avoid circular dependencies
        return await ImporterFactory.createKrakenImporter<T>(config);

      case 'coinbase':
        return await ImporterFactory.createCoinbaseImporter<T>(config);

      default:
        throw new Error(`Unsupported exchange importer: ${adapterId}`);
    }
  }

  /**
   * Create Injective importer.
   */
  private static async createInjectiveImporter<T>(config: ETLComponentConfig): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { InjectiveTransactionImporter } = await import('../../blockchains/injective/transaction-importer.ts');
    return new InjectiveTransactionImporter(config.dependencies) as unknown as IImporter<T>;
  }

  /**
   * Create Kraken CSV importer.
   */
  private static async createKrakenImporter<T>(_config: ETLComponentConfig): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { KrakenCsvImporter } = await import('../../exchanges/kraken/importer.ts');
    return new KrakenCsvImporter() as unknown as IImporter<T>;
  }

  /**
   * Create Solana importer.
   */
  private static async createSolanaImporter<T>(config: ETLComponentConfig): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { SolanaTransactionImporter } = await import('../../blockchains/solana/transaction-importer.ts');
    return new SolanaTransactionImporter(config.dependencies) as unknown as IImporter<T>;
  }

  /**
   * Check if an importer is available for the given adapter.
   */
  static isSupported(adapterId: string, adapterType: string): boolean {
    try {
      // Create a mock config to test support
      // Check supported adapters without creating mock config

      // Try to determine if we would be able to create this importer
      if (adapterType === 'exchange') {
        return ['kraken', 'coinbase'].includes(adapterId.toLowerCase());
      }

      if (adapterType === 'blockchain') {
        return ['bitcoin', 'ethereum', 'injective', 'solana', 'avalanche'].includes(adapterId.toLowerCase());
      }

      return false;
    } catch {
      return false;
    }
  }
}
