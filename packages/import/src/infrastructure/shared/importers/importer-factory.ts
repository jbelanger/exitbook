import type { IImporterFactory } from '@exitbook/import/app/ports/importer-factory.interface.ts';
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
    const { getEvmChainConfig } = await import('../../blockchains/evm/chain-registry.ts');
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
    const { getSubstrateChainConfig } = await import('../../blockchains/substrate/chain-registry.ts');
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
    const { getEvmChainConfig } = await import('../../blockchains/evm/chain-registry.ts');
    if (getEvmChainConfig(chainName)) {
      return await this.createEvmImporter(chainName, this.providerManager, providerId);
    }

    // Try Substrate chains (dynamically loaded from substrate-chains.json)
    const { getSubstrateChainConfig } = await import('../../blockchains/substrate/chain-registry.ts');
    if (getSubstrateChainConfig(chainName)) {
      return await this.createSubstrateImporter(chainName, this.providerManager, providerId);
    }

    // Try Cosmos SDK chains (dynamically loaded from cosmos-chains.json)
    const { getCosmosChainConfig } = await import('../../blockchains/cosmos/chain-registry.ts');
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
  private async createCoinbaseImporter(): Promise<IImporter> {
    // Dynamic import to avoid circular dependencies
    const { CoinbaseImporter } = await import('../../exchanges/coinbase/importer.js');
    return new CoinbaseImporter() as unknown as IImporter;
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
    const { getCosmosChainConfig } = await import('../../blockchains/cosmos/chain-registry.ts');
    const config = getCosmosChainConfig(chainName);
    if (!config) {
      throw new Error(`Cosmos chain config not found: ${chainName}`);
    }
    return new CosmosImporter(config, blockchainProviderManager, {
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
