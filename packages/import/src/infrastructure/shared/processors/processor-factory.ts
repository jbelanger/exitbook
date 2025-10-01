import type { IProcessorFactory } from '@exitbook/import/app/ports/processor-factory.js';
import type { ITransactionProcessor } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
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
  getSupportedSources(sourceType: 'exchange' | 'blockchain'): string[] {
    if (sourceType === 'exchange') {
      return ['kraken', 'kucoin', 'coinbase', 'ledgerlive'];
    }

    if (sourceType === 'blockchain') {
      return ['bitcoin', 'ethereum', 'injective', 'solana', 'avalanche', 'polkadot', 'bittensor'];
    }

    return [];
  }

  /**
   * Check if a processor is available for the given source.
   */
  isSupported(sourceId: string, sourceType: string): boolean {
    try {
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
    const { getEvmChainConfig } = await import('../../blockchains/evm/chain-registry.ts');
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
    const { getEvmChainConfig } = await import('../../blockchains/evm/chain-registry.ts');
    if (getEvmChainConfig(chainName)) {
      return await this.createEvmProcessor(chainName);
    }

    // Non-EVM chains
    switch (chainName) {
      case 'bitcoin':
        return await this.createBitcoinProcessor();

      case 'injective':
        return await this.createInjectiveProcessor();

      case 'solana':
        return await this.createSolanaProcessor();

      case 'polkadot':
        return await this.createPolkadotProcessor();

      case 'bittensor':
        return await this.createBittensorProcessor();

      default:
        throw new Error(`Unsupported blockchain processor: ${sourceId}`);
    }
  }

  /**
   * Create Coinbase processor.
   */
  private async createCoinbaseProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { CoinbaseProcessor } = await import('../../exchanges/coinbase/processor.js');
    return new CoinbaseProcessor();
  }

  /**
   * Create an exchange processor.
   */
  private async createExchangeProcessor(sourceId: string): Promise<ITransactionProcessor> {
    switch (sourceId.toLowerCase()) {
      case 'kraken':
        return await this.createKrakenProcessor();

      case 'kucoin':
        return await this.createKucoinProcessor();

      case 'coinbase':
        return await this.createCoinbaseProcessor();

      case 'ledgerlive':
        return await this.createLedgerLiveProcessor();

      default:
        throw new Error(`Unsupported exchange processor: ${sourceId}`);
    }
  }

  /**
   * Create Injective processor.
   */
  private async createInjectiveProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { InjectiveTransactionProcessor } = await import('../../blockchains/injective/processor.ts');
    return new InjectiveTransactionProcessor();
  }

  /**
   * Create Kraken processor.
   */
  private async createKrakenProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { KrakenProcessor } = await import('../../exchanges/kraken/processor.js');
    return new KrakenProcessor();
  }

  /**
   * Create KuCoin processor.
   */
  private async createKucoinProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { KucoinProcessor } = await import('../../exchanges/kucoin/processor.js');
    return new KucoinProcessor();
  }

  /**
   * Create Ledger Live processor.
   */
  private async createLedgerLiveProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { LedgerLiveProcessor } = await import('../../exchanges/ledgerlive/processor.js');
    return new LedgerLiveProcessor();
  }

  /**
   * Create Polkadot processor.
   */
  private async createPolkadotProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { SubstrateProcessor } = await import('../../blockchains/substrate/processor.ts');
    const { SUBSTRATE_CHAINS } = await import('../../blockchains/substrate/chain-registry.ts');
    return new SubstrateProcessor(SUBSTRATE_CHAINS.polkadot);
  }

  /**
   * Create Bittensor processor.
   */
  private async createBittensorProcessor(): Promise<ITransactionProcessor> {
    // Dynamic import to avoid circular dependencies
    const { SubstrateProcessor } = await import('../../blockchains/substrate/processor.ts');
    const { SUBSTRATE_CHAINS } = await import('../../blockchains/substrate/chain-registry.ts');
    return new SubstrateProcessor(SUBSTRATE_CHAINS.bittensor);
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
