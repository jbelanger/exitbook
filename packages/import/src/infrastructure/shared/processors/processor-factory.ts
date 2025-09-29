import { getLogger } from '@crypto/shared-logger';

import type { IProcessorFactory } from '../../../app/ports/processor-factory.ts';
import type { IProcessor } from '../../../app/ports/processors.ts';

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
      return ['bitcoin', 'ethereum', 'injective', 'solana', 'avalanche', 'polkadot'];
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
        return ['avalanche', 'bitcoin', 'ethereum', 'injective', 'solana'].includes(sourceId.toLowerCase());
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Create a processor for the specified source.
   */
  async create<T>(sourceId: string, sourceType: string): Promise<IProcessor> {
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
   * Create Avalanche processor.
   */
  private async createAvalancheProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { AvalancheTransactionProcessor } = await import('../../blockchains/avalanche/processor.ts');
    return new AvalancheTransactionProcessor();
  }

  /**
   * Create Bitcoin processor.
   */
  private async createBitcoinProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { BitcoinTransactionProcessor } = await import('../../blockchains/bitcoin/processor.ts');
    return new BitcoinTransactionProcessor();
  }

  /**
   * Create a blockchain processor.
   */
  private async createBlockchainProcessor(sourceId: string): Promise<IProcessor> {
    switch (sourceId.toLowerCase()) {
      case 'bitcoin':
        return await this.createBitcoinProcessor();

      case 'ethereum':
        return await this.createEthereumProcessor();

      case 'injective':
        return await this.createInjectiveProcessor();

      case 'solana':
        return await this.createSolanaProcessor();

      case 'avalanche':
        return await this.createAvalancheProcessor();

      case 'polkadot':
        return await this.createPolkadotProcessor();

      default:
        throw new Error(`Unsupported blockchain processor: ${sourceId}`);
    }
  }

  /**
   * Create Coinbase processor.
   */
  private async createCoinbaseProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { CoinbaseProcessor } = await import('../../exchanges/coinbase/processor.js');
    return new CoinbaseProcessor();
  }

  /**
   * Create Ethereum processor.
   */
  private async createEthereumProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { EthereumTransactionProcessor } = await import('../../blockchains/ethereum/transaction-processor.js');
    return new EthereumTransactionProcessor();
  }

  /**
   * Create an exchange processor.
   */
  private async createExchangeProcessor(sourceId: string): Promise<IProcessor> {
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
  private async createInjectiveProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { InjectiveTransactionProcessor } = await import('../../blockchains/injective/processor.ts');
    return new InjectiveTransactionProcessor();
  }

  /**
   * Create Kraken processor.
   */
  private async createKrakenProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { KrakenProcessor } = await import('../../exchanges/kraken/processor.js');
    return new KrakenProcessor();
  }

  /**
   * Create KuCoin processor.
   */
  private async createKucoinProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { KucoinProcessor } = await import('../../exchanges/kucoin/processor.js');
    return new KucoinProcessor();
  }

  /**
   * Create Ledger Live processor.
   */
  private async createLedgerLiveProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { LedgerLiveProcessor } = await import('../../exchanges/ledgerlive/processor.js');
    return new LedgerLiveProcessor();
  }

  /**
   * Create Polkadot processor.
   */
  private async createPolkadotProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { PolkadotTransactionProcessor } = await import('../../blockchains/polkadot/processor.ts');
    return new PolkadotTransactionProcessor();
  }

  /**
   * Create Solana processor.
   */
  private async createSolanaProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { SolanaTransactionProcessor } = await import('../../blockchains/solana/processor.ts');
    return new SolanaTransactionProcessor();
  }
}
