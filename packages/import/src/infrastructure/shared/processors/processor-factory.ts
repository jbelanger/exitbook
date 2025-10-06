import type { IProcessorFactory } from '@exitbook/import/app/ports/processor-factory.js';
import type { ITransactionProcessor } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import {
  EVM_CHAINS,
  SUBSTRATE_CHAINS,
  COSMOS_CHAINS,
  getEvmChainConfig,
  getSubstrateChainConfig,
  getCosmosChainConfig,
} from '@exitbook/providers';
import { getLogger } from '@exitbook/shared-logger';

/**
 * Factory for creating processor instances.
 * Handles dependency injection and source-specific instantiation.
 */
export class ProcessorFactory implements IProcessorFactory {
  private readonly logger = getLogger('ProcessorFactory');

  /**
   * Get all supported sources for a given type.
   */
  async getSupportedSources(sourceType: 'exchange' | 'blockchain'): Promise<string[]> {
    if (sourceType === 'exchange') {
      return ['kraken', 'kucoin', 'ledgerlive', 'coinbase'];
    }

    if (sourceType === 'blockchain') {
      // Load dynamic chains

      const evmChains = Object.keys(EVM_CHAINS);
      const substrateChains = Object.keys(SUBSTRATE_CHAINS);
      const cosmosChains = Object.keys(COSMOS_CHAINS);
      const nonEvmChains = ['bitcoin', 'solana'];

      return [...evmChains, ...substrateChains, ...cosmosChains, ...nonEvmChains];
    }

    return Promise.resolve([]);
  }

  /**
   * Check if a processor is available for the given source.
   */
  async isSupported(sourceId: string, sourceType: string): Promise<boolean> {
    try {
      if (sourceType === 'exchange') {
        return ['coinbase', 'kraken', 'kucoin', 'ledgerlive'].includes(sourceId.toLowerCase());
      }

      if (sourceType === 'blockchain') {
        const supportedChains = await this.getSupportedSources('blockchain');
        return supportedChains.includes(sourceId.toLowerCase());
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Create a processor for the specified source.
   */
  async create(sourceId: string, sourceType: string): Promise<ITransactionProcessor> {
    this.logger.info(`Creating processor for ${sourceId} (type: ${sourceType})`);

    if (sourceType === 'exchange') {
      return await this.createExchangeProcessor(sourceId);
    }

    if (sourceType === 'blockchain') {
      return await this.createBlockchainProcessor(sourceId);
    }

    throw new Error(`Unsupported source type: ${sourceType}`);
  }

  /**
   * Create EVM-compatible chain processor (Ethereum, Avalanche, Polygon, etc.).
   * Looks up chain config from evm-chains.json registry.
   */
  private async createEvmProcessor(chainName: string): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { EvmTransactionProcessor } = await import('../../blockchains/evm/processor.ts');
    const config = getEvmChainConfig(chainName);
    if (!config) {
      throw new Error(`EVM chain config not found: ${chainName}`);
    }
    return new EvmTransactionProcessor(config);
  }

  /**
   * Create Bitcoin processor.
   */
  private async createBitcoinProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { BitcoinTransactionProcessor } = await import('../../blockchains/bitcoin/processor.ts');
    return new BitcoinTransactionProcessor();
  }

  /**
   * Create a blockchain processor.
   */
  private async createBlockchainProcessor(sourceId: string): Promise<ITransactionProcessor> {
    const chainName = sourceId.toLowerCase();

    // Try EVM chains first (dynamically loaded from evm-chains.json)
    if (getEvmChainConfig(chainName)) {
      return await this.createEvmProcessor(chainName);
    }

    // Try Substrate chains (dynamically loaded from substrate-chains.json)
    if (getSubstrateChainConfig(chainName)) {
      return await this.createSubstrateProcessor(chainName);
    }

    // Try Cosmos SDK chains (dynamically loaded from cosmos-chains.json)
    if (getCosmosChainConfig(chainName)) {
      return await this.createCosmosProcessor(chainName);
    }

    // Non-EVM, non-Substrate, non-Cosmos chains
    switch (chainName) {
      case 'bitcoin':
        return await this.createBitcoinProcessor();

      case 'solana':
        return await this.createSolanaProcessor();

      default:
        throw new Error(`Unsupported blockchain processor: ${sourceId}`);
    }
  }

  /**
   * Create an exchange processor.
   */
  private async createExchangeProcessor(sourceId: string): Promise<ITransactionProcessor> {
    switch (sourceId.toLowerCase()) {
      case 'kraken':
        return await this.createKrakenProcessor();

      case 'coinbase':
        return await this.createCoinbaseProcessor();

      default:
        throw new Error(`Unsupported exchange processor: ${sourceId}`);
    }
  }

  /**
   * Create Cosmos SDK chain processor (Injective, Osmosis, Cosmos Hub, etc.).
   * Looks up chain config from cosmos-chains.json registry.
   */
  private async createCosmosProcessor(chainName: string): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { CosmosProcessor } = await import('../../blockchains/cosmos/processor.ts');
    const config = getCosmosChainConfig(chainName);
    if (!config) {
      throw new Error(`Cosmos chain config not found: ${chainName}`);
    }
    return new CosmosProcessor(config);
  }

  /**
   * Create Kraken processor.
   */
  private async createKrakenProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { KrakenProcessor } = await import('../../exchanges/kraken/processor.ts');
    return new KrakenProcessor();
  }

  /**
   * Create Coinbase processor.
   */
  private async createCoinbaseProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { CoinbaseProcessor } = await import('../../exchanges/coinbase/processor.ts');
    return new CoinbaseProcessor();
  }

  /**
   * Create Substrate-based chain processor (Polkadot, Bittensor, Kusama, etc.).
   * Looks up chain config from substrate-chains.json registry.
   */
  private async createSubstrateProcessor(chainName: string): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { SubstrateProcessor } = await import('../../blockchains/substrate/processor.ts');
    const config = getSubstrateChainConfig(chainName);
    if (!config) {
      throw new Error(`Substrate chain config not found: ${chainName}`);
    }
    return new SubstrateProcessor(config);
  }

  /**
   * Create Solana processor.
   */
  private async createSolanaProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { SolanaTransactionProcessor } = await import('../../blockchains/solana/processor.ts');
    return new SolanaTransactionProcessor();
  }
}
