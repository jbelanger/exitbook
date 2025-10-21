import type { BlockchainProviderManager } from '@exitbook/providers';
import { getCosmosChainConfig, getEvmChainConfig, getSubstrateChainConfig } from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';

import type { IImporterFactory } from '../../../types/factories.ts';
import type { IImporter, ImportParams } from '../../../types/importers.ts';

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
  async create(sourceId: string, sourceType: string, params?: ImportParams): Promise<IImporter> {
    this.logger.info(`Creating importer for ${sourceId} (type: ${sourceType})`);

    if (sourceType === 'exchange') {
      return await this.createExchangeImporter(sourceId, params);
    }

    if (sourceType === 'blockchain') {
      return await this.createBlockchainImporter(sourceId, params?.providerId);
    }

    throw new Error(`Unsupported source type: ${sourceType}`);
  }

  /**
   * Create EVM-compatible chain importer (Ethereum, Avalanche, Polygon, etc.).
   * Looks up chain config from evm-chains.json registry.
   */
  private async createEvmImporter(
    chainName: string,
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { EvmImporter } = await import('../../blockchains/evm/importer.ts');
    const config = getEvmChainConfig(chainName);
    if (!config) {
      throw new Error(`EVM chain config not found: ${chainName}`);
    }
    return new EvmImporter(config, blockchainProviderManager, {
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
   * Create Substrate-based chain importer (Polkadot, Bittensor, Kusama, etc.).
   * Looks up chain config from substrate-chains.json registry.
   */
  private async createSubstrateImporter(
    chainName: string,
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { SubstrateImporter } = await import('../../blockchains/substrate/importer.ts');

    const config = getSubstrateChainConfig(chainName);
    if (!config) {
      throw new Error(`Substrate chain config not found: ${chainName}`);
    }
    return new SubstrateImporter(config, blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter;
  }

  /**
   * Create a blockchain importer.
   */
  private async createBlockchainImporter(sourceId: string, providerId: string | undefined): Promise<IImporter> {
    // providerId is optional - when not provided, importers will use all available providers

    const chainName = sourceId.toLowerCase();

    // Try EVM chains first (dynamically loaded from evm-chains.json)
    if (getEvmChainConfig(chainName)) {
      return await this.createEvmImporter(chainName, this.providerManager, providerId);
    }

    // Try Substrate chains (dynamically loaded from substrate-chains.json)
    if (getSubstrateChainConfig(chainName)) {
      return await this.createSubstrateImporter(chainName, this.providerManager, providerId);
    }

    // Try Cosmos SDK chains (dynamically loaded from cosmos-chains.json)
    if (getCosmosChainConfig(chainName)) {
      return await this.createCosmosImporter(chainName, this.providerManager, providerId);
    }

    // Non-EVM, non-Substrate, non-Cosmos chains
    switch (chainName) {
      case 'bitcoin':
        return await this.createBitcoinImporter(this.providerManager, providerId);

      case 'solana':
        return await this.createSolanaImporter(this.providerManager, providerId);

      default:
        throw new Error(`Unsupported blockchain importer: ${sourceId}`);
    }
  }

  /**
   * Create Coinbase importer.
   */
  /**
   * Create an exchange importer.
   * Decides between CSV or API importer based on ImportParams.
   */
  private async createExchangeImporter(sourceId: string, params?: ImportParams): Promise<IImporter> {
    switch (sourceId.toLowerCase()) {
      case 'coinbase':
        return await this.createCoinbaseImporter();

      case 'kraken':
        return await this.createKrakenImporter();

      case 'kucoin':
        return await this.createKuCoinImporter(params);

      default:
        throw new Error(`Unsupported exchange importer: ${sourceId}`);
    }
  }

  /**
   * Create Cosmos SDK chain importer (Injective, Osmosis, Cosmos Hub, etc.).
   * Looks up chain config from cosmos-chains.json registry.
   */
  private async createCosmosImporter(
    chainName: string,
    blockchainProviderManager: BlockchainProviderManager,
    providerId: string | undefined
  ): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { CosmosImporter } = await import('../../blockchains/cosmos/importer.ts');
    const config = getCosmosChainConfig(chainName);
    if (!config) {
      throw new Error(`Cosmos chain config not found: ${chainName}`);
    }
    return new CosmosImporter(config, blockchainProviderManager, {
      preferredProvider: providerId,
    }) as unknown as IImporter;
  }

  /**
   * Create Kraken importer (CSV or API based on params).
   */
  private async createKrakenImporter(): Promise<IImporter> {
    const { KrakenApiImporter } = await import('../../exchanges/kraken/importer.ts');
    return new KrakenApiImporter() as unknown as IImporter;
  }

  /**
   * Create Coinbase importer.
   */
  private async createCoinbaseImporter(): Promise<IImporter> {
    const { CoinbaseApiImporter } = await import('../../exchanges/coinbase/importer.ts');
    return new CoinbaseApiImporter() as unknown as IImporter;
  }

  /**
   * Create KuCoin importer (CSV or API based on params).
   */
  private async createKuCoinImporter(params?: ImportParams): Promise<IImporter> {
    // If CSV directories are provided, use CSV importer
    if (params && params.csvDirectories && Array.isArray(params.csvDirectories) && params.csvDirectories.length > 0) {
      const { KucoinCsvImporter } = await import('../../exchanges/kucoin/importer-csv.ts');
      return new KucoinCsvImporter() as unknown as IImporter;
    }

    // Otherwise, use API importer
    const { KuCoinApiImporter } = await import('../../exchanges/kucoin/importer.ts');
    return new KuCoinApiImporter() as unknown as IImporter;
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
