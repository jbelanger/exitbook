import type { IImporterFactory } from '@exitbook/import/app/ports/importer-factory.js';
import type { IImporter } from '@exitbook/import/app/ports/importers.js';
import { getLogger } from '@exitbook/shared-logger';

import type { BlockchainProviderManager } from '../../blockchains/shared/index.js';

/**
 * Factory for creating importer instances.
 * Handles dependency injection and source-specific instantiation.
 */
export class ImporterFactory implements IImporterFactory {
  private readonly logger = getLogger('ImporterFactory');

  constructor(private providerManager: BlockchainProviderManager) {}

  /**
   * Create an importer for the specified source.
   */
  async create(sourceId: string, sourceType: string, providerId?: string): Promise<IImporter> {
    this.logger.info(`Creating importer for ${sourceId} (type: ${sourceType})`);

    if (sourceType === 'exchange') {
      return await this.createExchangeImporter(sourceId);
    }

    if (sourceType === 'blockchain') {
      return await this.createBlockchainImporter(sourceId, providerId);
    }

    throw new Error(`Unsupported source type: ${sourceType}`);
  }

  /**
   * Create Avalanche importer.
   */
  private async createAvalancheImporter(
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
  private async createBitcoinImporter(
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
  private async createBittensorImporter(
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
  private async createBlockchainImporter(sourceId: string, providerId: string | undefined): Promise<IImporter> {
    // providerId is optional - when not provided, importers will use all available providers

    switch (sourceId.toLowerCase()) {
      case 'bitcoin':
        return await this.createBitcoinImporter(this.providerManager, providerId);

      case 'ethereum':
        return await this.createEthereumImporter(this.providerManager, providerId);

      case 'injective':
        return await this.createInjectiveImporter(this.providerManager, providerId);

      case 'solana':
        return await this.createSolanaImporter(this.providerManager, providerId);

      case 'avalanche':
        return await this.createAvalancheImporter(this.providerManager, providerId);

      case 'polkadot':
        return await this.createPolkadotImporter(this.providerManager, providerId);

      case 'bittensor':
        return await this.createBittensorImporter(this.providerManager, providerId);

      default:
        throw new Error(`Unsupported blockchain importer: ${sourceId}`);
    }
  }

  /**
   * Create Coinbase importer.
   */
  private async createCoinbaseImporter(): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { CoinbaseImporter } = await import('../../exchanges/coinbase/importer.js');
    return new CoinbaseImporter() as unknown as IImporter;
  }

  /**
   * Create Ethereum importer.
   */
  private async createEthereumImporter(
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
  private async createExchangeImporter(sourceId: string): Promise<IImporter> {
    switch (sourceId.toLowerCase()) {
      case 'kraken':
        // Dynamic import to avoid circular dependencies
        return await this.createKrakenImporter();

      case 'kucoin':
        return await this.createKucoinImporter();

      case 'coinbase':
        return await this.createCoinbaseImporter();

      case 'ledgerlive':
        return await this.createLedgerLiveImporter();

      default:
        throw new Error(`Unsupported exchange importer: ${sourceId}`);
    }
  }

  /**
   * Create Injective importer.
   */
  private async createInjectiveImporter(
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
  private async createKrakenImporter(): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { KrakenCsvImporter } = await import('../../exchanges/kraken/importer.js');
    return new KrakenCsvImporter() as unknown as IImporter;
  }

  /**
   * Create KuCoin CSV importer.
   */
  private async createKucoinImporter(): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { KucoinCsvImporter } = await import('../../exchanges/kucoin/importer.js');
    return new KucoinCsvImporter() as unknown as IImporter;
  }

  /**
   * Create Ledger Live CSV importer.
   */
  private async createLedgerLiveImporter(): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { LedgerLiveCsvImporter } = await import('../../exchanges/ledgerlive/importer.js');
    return new LedgerLiveCsvImporter() as unknown as IImporter;
  }

  /**
   * Create Polkadot importer.
   */
  private async createPolkadotImporter(
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
  private async createSolanaImporter(
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
