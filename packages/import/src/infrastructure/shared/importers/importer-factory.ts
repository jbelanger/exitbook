import { getLogger } from '@crypto/shared-logger';

import type { IImporterFactory } from '../../../app/ports/importer-factory.ts';
import type { IImporter } from '../../../app/ports/importers.ts';
import type { BlockchainProviderManager } from '../../blockchains/shared/index.js';

/**
 * Factory for creating importer instances.
 * Handles dependency injection and source-specific instantiation.
 */
export class ImporterFactory implements IImporterFactory {
  private readonly logger = getLogger('ImporterFactory');

  constructor(private providerManager: BlockchainProviderManager) {}

  /**
   * Check if an importer is available for the given source.
   */
  isSupported(sourceId: string, sourceType: string): boolean {
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
  async create<T>(sourceId: string, sourceType: string, providerId?: string): Promise<IImporter> {
    this.logger.info(`Creating importer for ${sourceId} (type: ${sourceType})`);

    if (sourceType === 'exchange') {
      return await this.createExchangeImporter<T>(sourceId);
    }

    if (sourceType === 'blockchain') {
      return await this.createBlockchainImporter<T>(sourceId, providerId);
    }

    throw new Error(`Unsupported source type: ${sourceType}`);
  }

  /**
   * Create Avalanche importer.
   */
  private async createAvalancheImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { AvalancheTransactionImporter } = await import('../../blockchains/avalanche/importer.ts');
    return new AvalancheTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter;
  }

  /**
   * Create Bitcoin importer.
   */
  private async createBitcoinImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { BitcoinTransactionImporter } = await import('../../blockchains/bitcoin/importer.ts');
    return new BitcoinTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter;
  }

  /**
   * Create Bittensor importer.
   */
  private async createBittensorImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { BittensorTransactionImporter } = await import('../../blockchains/polkadot/bittensor-importer.ts');
    return new BittensorTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter;
  }

  /**
   * Create a blockchain importer.
   */
  private async createBlockchainImporter<T>(sourceId: string, providerId: string | undefined): Promise<IImporter> {
    // providerId is optional - when not provided, importers will use all available providers

    switch (sourceId.toLowerCase()) {
      case 'bitcoin':
        return await this.createBitcoinImporter<T>(this.providerManager, providerId);

      case 'ethereum':
        return await this.createEthereumImporter<T>(this.providerManager, providerId);

      case 'injective':
        return await this.createInjectiveImporter<T>(this.providerManager, providerId);

      case 'solana':
        return await this.createSolanaImporter<T>(this.providerManager, providerId);

      case 'avalanche':
        return await this.createAvalancheImporter<T>(this.providerManager, providerId);

      case 'polkadot':
        return await this.createPolkadotImporter<T>(this.providerManager, providerId);

      case 'bittensor':
        return await this.createBittensorImporter<T>(this.providerManager, providerId);

      default:
        throw new Error(`Unsupported blockchain importer: ${sourceId}`);
    }
  }

  /**
   * Create Coinbase importer.
   */
  private async createCoinbaseImporter<T>(): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { CoinbaseImporter } = await import('../../exchanges/coinbase/importer.js');
    return new CoinbaseImporter() as unknown as IImporter;
  }

  /**
   * Create Ethereum importer.
   */
  private async createEthereumImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { EthereumTransactionImporter } = await import('../../blockchains/ethereum/importer.ts');
    return new EthereumTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter;
  }

  /**
   * Create an exchange importer.
   */
  private async createExchangeImporter<T>(sourceId: string): Promise<IImporter> {
    switch (sourceId.toLowerCase()) {
      case 'kraken':
        // Dynamic import to avoid circular dependencies
        return await this.createKrakenImporter<T>();

      case 'kucoin':
        return await this.createKucoinImporter<T>();

      case 'coinbase':
        return await this.createCoinbaseImporter<T>();

      case 'ledgerlive':
        return await this.createLedgerLiveImporter<T>();

      default:
        throw new Error(`Unsupported exchange importer: ${sourceId}`);
    }
  }

  /**
   * Create Injective importer.
   */
  private async createInjectiveImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { InjectiveTransactionImporter } = await import('../../blockchains/injective/importer.ts');
    return new InjectiveTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter;
  }

  /**
   * Create Kraken CSV importer.
   */
  private async createKrakenImporter<T>(): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { KrakenCsvImporter } = await import('../../exchanges/kraken/importer.js');
    return new KrakenCsvImporter() as unknown as IImporter;
  }

  /**
   * Create KuCoin CSV importer.
   */
  private async createKucoinImporter<T>(): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { KucoinCsvImporter } = await import('../../exchanges/kucoin/importer.js');
    return new KucoinCsvImporter() as unknown as IImporter;
  }

  /**
   * Create Ledger Live CSV importer.
   */
  private async createLedgerLiveImporter<T>(): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { LedgerLiveCsvImporter } = await import('../../exchanges/ledgerlive/importer.js');
    return new LedgerLiveCsvImporter() as unknown as IImporter;
  }

  /**
   * Create Polkadot importer.
   */
  private async createPolkadotImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { PolkadotTransactionImporter } = await import('../../blockchains/polkadot/polkadot-importer.ts');
    return new PolkadotTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter;
  }

  /**
   * Create Solana importer.
   */
  private async createSolanaImporter<T>(
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { SolanaTransactionImporter } = await import('../../blockchains/solana/importer.ts');
    return new SolanaTransactionImporter(blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter;
  }
}
