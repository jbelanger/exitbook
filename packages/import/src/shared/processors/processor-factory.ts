import { getLogger } from '@crypto/shared-logger';

import type { ETLComponentConfig } from '../common/interfaces.ts';
import type { IProcessor } from './interfaces.ts';

/**
 * Factory for creating processor instances.
 * Handles dependency injection and source-specific instantiation.
 */
export class ProcessorFactory {
  private static readonly logger = getLogger('ProcessorFactory');

  /**
   * Create a processor for the specified source.
   */
  static async create<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    const { sourceId: sourceId, sourceType: sourceType } = config;

    ProcessorFactory.logger.info(`Creating processor for ${sourceId} (type: ${sourceType})`);

    if (sourceType === 'exchange') {
      return await ProcessorFactory.createExchangeProcessor<T>(config);
    }

    if (sourceType === 'blockchain') {
      return await ProcessorFactory.createBlockchainProcessor<T>(config);
    }

    throw new Error(`Unsupported source type: ${sourceType}`);
  }

  /**
   * Create Avalanche processor.
   */
  private static async createAvalancheProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { AvalancheTransactionProcessor } = await import('../../blockchains/avalanche/transaction-processor.ts');
    return new AvalancheTransactionProcessor(config.dependencies) as unknown as IProcessor<T>;
  }

  /**
   * Create Bitcoin processor.
   */
  private static async createBitcoinProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { BitcoinTransactionProcessor } = await import('../../blockchains/bitcoin/transaction-processor.ts');
    return new BitcoinTransactionProcessor(config.dependencies) as unknown as IProcessor<T>;
  }

  /**
   * Create a blockchain processor.
   */
  private static async createBlockchainProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    const { sourceId: sourceId } = config;

    switch (sourceId.toLowerCase()) {
      case 'bitcoin':
        return await ProcessorFactory.createBitcoinProcessor<T>(config);

      case 'ethereum':
        return await ProcessorFactory.createEthereumProcessor<T>(config);

      case 'injective':
        return await ProcessorFactory.createInjectiveProcessor<T>(config);

      case 'solana':
        return await ProcessorFactory.createSolanaProcessor<T>(config);

      case 'avalanche':
        return await ProcessorFactory.createAvalancheProcessor<T>(config);

      case 'polkadot':
        return await ProcessorFactory.createPolkadotProcessor<T>(config);

      default:
        throw new Error(`Unsupported blockchain processor: ${sourceId}`);
    }
  }

  /**
   * Create Coinbase processor.
   */
  private static async createCoinbaseProcessor<T>(_config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { CoinbaseProcessor } = await import('../../exchanges/coinbase/processor.ts');
    return new CoinbaseProcessor() as unknown as IProcessor<T>;
  }

  /**
   * Create Ethereum processor.
   */
  private static async createEthereumProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { EthereumTransactionProcessor } = await import('../../blockchains/ethereum/transaction-processor.ts');
    return new EthereumTransactionProcessor(config.dependencies) as unknown as IProcessor<T>;
  }

  /**
   * Create an exchange processor.
   */
  private static async createExchangeProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    const { sourceId: sourceId } = config;

    switch (sourceId.toLowerCase()) {
      case 'kraken':
        return await ProcessorFactory.createKrakenProcessor<T>(config);

      case 'kucoin':
        return await ProcessorFactory.createKucoinProcessor<T>(config);

      case 'coinbase':
        return await ProcessorFactory.createCoinbaseProcessor<T>(config);

      case 'ledgerlive':
        return await ProcessorFactory.createLedgerLiveProcessor<T>(config);

      default:
        throw new Error(`Unsupported exchange processor: ${sourceId}`);
    }
  }

  /**
   * Create Injective processor.
   */
  private static async createInjectiveProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { InjectiveTransactionProcessor } = await import('../../blockchains/injective/transaction-processor.ts');
    return new InjectiveTransactionProcessor(config.dependencies) as unknown as IProcessor<T>;
  }

  /**
   * Create Kraken processor.
   */
  private static async createKrakenProcessor<T>(_config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { KrakenProcessor } = await import('../../exchanges/kraken/processor.ts');
    return new KrakenProcessor() as unknown as IProcessor<T>;
  }

  /**
   * Create KuCoin processor.
   */
  private static async createKucoinProcessor<T>(_config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { KucoinProcessor } = await import('../../exchanges/kucoin/processor.ts');
    return new KucoinProcessor() as unknown as IProcessor<T>;
  }

  /**
   * Create Ledger Live processor.
   */
  private static async createLedgerLiveProcessor<T>(_config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { LedgerLiveProcessor } = await import('../../exchanges/ledgerlive/processor.ts');
    return new LedgerLiveProcessor() as unknown as IProcessor<T>;
  }

  /**
   * Create Polkadot processor.
   */
  private static async createPolkadotProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { PolkadotTransactionProcessor } = await import('../../blockchains/polkadot/transaction-processor.ts');
    return new PolkadotTransactionProcessor(config.dependencies) as unknown as IProcessor<T>;
  }

  /**
   * Create Solana processor.
   */
  private static async createSolanaProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    // Dynamic import to avoid circular dependencies
    const { SolanaTransactionProcessor } = await import('../../blockchains/solana/transaction-processor.ts');
    return new SolanaTransactionProcessor(config.dependencies) as unknown as IProcessor<T>;
  }

  /**
   * Get all supported sources for a given type.
   */
  static getSupportedSources(sourceType: 'exchange' | 'blockchain'): string[] {
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
  static isSupported(sourceId: string, sourceType: string): boolean {
    try {
      if (sourceType === 'exchange') {
        return ['kraken', 'kucoin', 'coinbase', 'ledgerlive'].includes(sourceId.toLowerCase());
      }

      if (sourceType === 'blockchain') {
        return ['bitcoin', 'ethereum', 'injective', 'solana', 'avalanche'].includes(sourceId.toLowerCase());
      }

      return false;
    } catch {
      return false;
    }
  }
}
