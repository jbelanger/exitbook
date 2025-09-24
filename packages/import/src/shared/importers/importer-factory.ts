import { getLogger } from '@crypto/shared-logger';

import type { BlockchainProviderManager } from '../../blockchains/shared/index.js';

import type { IImporter } from './interfaces.js';

/**
 * Factory for creating importer instances.
 * Handles dependency injection and source-specific instantiation.
 */
export class ImporterFactory {
  private static readonly logger = getLogger('ImporterFactory');

  /**
   * Check if an importer is available for the given source.
   */
  static isSupported(sourceId: string, sourceType: string): boolean {
    try {
      // Create a mock config to test support
      // Check supported sources without creating mock config

      // Try to determine if we would be able to create this importer
      if (sourceType === 'exchange') {
        return ['coinbase', 'kraken', 'kucoin', 'ledgerlive'].includes(sourceId.toLowerCase());
      }

      if (sourceType === 'blockchain') {
        return ['avalanche', 'bitcoin', 'bittensor', 'ethereum', 'injective', 'polkadot', 'solana'].includes(
          sourceId.toLowerCase()
        );
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Create an importer for the specified source.
   */
  static async create<T>(
    sourceId: string,
    sourceType: string,
    providerId: string | undefined,
    providerManager: BlockchainProviderManager | undefined
  ): Promise<IImporter<T>> {
    ImporterFactory.logger.info(`Creating importer for ${sourceId} (type: ${sourceType})`);

    if (sourceType === 'exchange') {
      return await ImporterFactory.createExchangeImporter<T>(sourceId);
    }

    if (sourceType === 'blockchain') {
      return await ImporterFactory.createBlockchainImporter<T>(providerManager, sourceId, providerId);
    }

    throw new Error(`Unsupported source type: ${sourceType}`);
  }

  /**
   * Create Avalanche importer.
   */
  private static async createAvalancheImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { AvalancheTransactionImporter } = await import('../../blockchains/avalanche/transaction-importer.js');
    return new AvalancheTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter<T>;
  }

  /**
   * Create Bitcoin importer.
   */
  private static async createBitcoinImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { BitcoinTransactionImporter } = await import('../../blockchains/bitcoin/transaction-importer.js');
    return new BitcoinTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter<T>;
  }

  /**
   * Create Bittensor importer.
   */
  private static async createBittensorImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { BittensorTransactionImporter } = await import(
      '../../blockchains/polkadot/bittensor-transaction-importer.js'
    );
    return new BittensorTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter<T>;
  }

  /**
   * Create a blockchain importer.
   */
  private static async createBlockchainImporter<T>(
    providerManager: BlockchainProviderManager | undefined,
    sourceId: string,
    providerId: string | undefined
  ): Promise<IImporter<T>> {
    if (!providerManager) {
      throw new Error(`Provider manager required for blockchain importer`);
    }

    // providerId is optional - when not provided, importers will use all available providers

    switch (sourceId.toLowerCase()) {
      case 'bitcoin':
        return await ImporterFactory.createBitcoinImporter<T>(providerManager, providerId);

      case 'ethereum':
        return await ImporterFactory.createEthereumImporter<T>(providerManager, providerId);

      case 'injective':
        return await ImporterFactory.createInjectiveImporter<T>(providerManager, providerId);

      case 'solana':
        return await ImporterFactory.createSolanaImporter<T>(providerManager, providerId);

      case 'avalanche':
        return await ImporterFactory.createAvalancheImporter<T>(providerManager, providerId);

      case 'polkadot':
        return await ImporterFactory.createPolkadotImporter<T>(providerManager, providerId);

      case 'bittensor':
        return await ImporterFactory.createBittensorImporter<T>(providerManager, providerId);

      default:
        throw new Error(`Unsupported blockchain importer: ${sourceId}`);
    }
  }

  /**
   * Create Coinbase importer.
   */
  private static async createCoinbaseImporter<T>(): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { CoinbaseImporter } = await import('../../exchanges/coinbase/importer.js');
    return new CoinbaseImporter() as unknown as IImporter<T>;
  }

  /**
   * Create Ethereum importer.
   */
  private static async createEthereumImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { EthereumTransactionImporter } = await import('../../blockchains/ethereum/transaction-importer.js');
    return new EthereumTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter<T>;
  }

  /**
   * Create an exchange importer.
   */
  private static async createExchangeImporter<T>(sourceId: string): Promise<IImporter<T>> {
    switch (sourceId.toLowerCase()) {
      case 'kraken':
        // Dynamic import to avoid circular dependencies
        return await ImporterFactory.createKrakenImporter<T>();

      case 'kucoin':
        return await ImporterFactory.createKucoinImporter<T>();

      case 'coinbase':
        return await ImporterFactory.createCoinbaseImporter<T>();

      case 'ledgerlive':
        return await ImporterFactory.createLedgerLiveImporter<T>();

      default:
        throw new Error(`Unsupported exchange importer: ${sourceId}`);
    }
  }

  /**
   * Create Injective importer.
   */
  private static async createInjectiveImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { InjectiveTransactionImporter } = await import('../../blockchains/injective/transaction-importer.js');
    return new InjectiveTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter<T>;
  }

  /**
   * Create Kraken CSV importer.
   */
  private static async createKrakenImporter<T>(): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { KrakenCsvImporter } = await import('../../exchanges/kraken/importer.js');
    return new KrakenCsvImporter() as unknown as IImporter<T>;
  }

  /**
   * Create KuCoin CSV importer.
   */
  private static async createKucoinImporter<T>(): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { KucoinCsvImporter } = await import('../../exchanges/kucoin/importer.js');
    return new KucoinCsvImporter() as unknown as IImporter<T>;
  }

  /**
   * Create Ledger Live CSV importer.
   */
  private static async createLedgerLiveImporter<T>(): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { LedgerLiveCsvImporter } = await import('../../exchanges/ledgerlive/importer.js');
    return new LedgerLiveCsvImporter() as unknown as IImporter<T>;
  }

  /**
   * Create Polkadot importer.
   */
  private static async createPolkadotImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { PolkadotTransactionImporter } = await import('../../blockchains/polkadot/transaction-importer.js');
    return new PolkadotTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter<T>;
  }

  /**
   * Create Solana importer.
   */
  private static async createSolanaImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter<T>> {
    // Dynamic import to avoid circular dependencies
    const { SolanaTransactionImporter } = await import('../../blockchains/solana/transaction-importer.js');
    return new SolanaTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter<T>;
  }
}
