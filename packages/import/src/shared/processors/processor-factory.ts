import { getLogger } from '@crypto/shared-logger';

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
  static async create<T>(sourceId: string, sourceType: string): Promise<IProcessor> {
    ProcessorFactory.logger.info(`Creating processor for ${sourceId} (type: ${sourceType})`);

    if (sourceType === 'exchange') {
      return await ProcessorFactory.createExchangeProcessor(sourceId);
    }

    if (sourceType === 'blockchain') {
      return await ProcessorFactory.createBlockchainProcessor(sourceId);
    }

    throw new Error(`Unsupported source type: ${sourceType}`);
  }

  /**
   * Create Avalanche processor.
   */
  private static async createAvalancheProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { AvalancheTransactionProcessor } = await import('../../blockchains/avalanche/transaction-processor.ts');
    return new AvalancheTransactionProcessor();
  }

  /**
   * Create Bitcoin processor.
   */
  private static async createBitcoinProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { BitcoinTransactionProcessor } = await import('../../blockchains/bitcoin/transaction-processor.ts');
    return new BitcoinTransactionProcessor();
  }

  /**
   * Create a blockchain processor.
   */
  private static async createBlockchainProcessor(sourceId: string): Promise<IProcessor> {
    switch (sourceId.toLowerCase()) {
      case 'bitcoin':
        return await ProcessorFactory.createBitcoinProcessor();

      case 'ethereum':
        return await ProcessorFactory.createEthereumProcessor();

      case 'injective':
        return await ProcessorFactory.createInjectiveProcessor();

      case 'solana':
        return await ProcessorFactory.createSolanaProcessor();

      case 'avalanche':
        return await ProcessorFactory.createAvalancheProcessor();

      case 'polkadot':
        return await ProcessorFactory.createPolkadotProcessor();

      default:
        throw new Error(`Unsupported blockchain processor: ${sourceId}`);
    }
  }

  /**
   * Create Coinbase processor.
   */
  private static async createCoinbaseProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { CoinbaseProcessor } = await import('../../exchanges/coinbase/processor.ts');
    return new CoinbaseProcessor();
  }

  /**
   * Create Ethereum processor.
   */
  private static async createEthereumProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { EthereumTransactionProcessor } = await import('../../blockchains/ethereum/transaction-processor.ts');
    return new EthereumTransactionProcessor();
  }

  /**
   * Create an exchange processor.
   */
  private static async createExchangeProcessor(sourceId: string): Promise<IProcessor> {
    switch (sourceId.toLowerCase()) {
      case 'kraken':
        return await ProcessorFactory.createKrakenProcessor();

      case 'kucoin':
        return await ProcessorFactory.createKucoinProcessor();

      case 'coinbase':
        return await ProcessorFactory.createCoinbaseProcessor();

      case 'ledgerlive':
        return await ProcessorFactory.createLedgerLiveProcessor();

      default:
        throw new Error(`Unsupported exchange processor: ${sourceId}`);
    }
  }

  /**
   * Create Injective processor.
   */
  private static async createInjectiveProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { InjectiveTransactionProcessor } = await import('../../blockchains/injective/transaction-processor.ts');
    return new InjectiveTransactionProcessor();
  }

  /**
   * Create Kraken processor.
   */
  private static async createKrakenProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { KrakenProcessor } = await import('../../exchanges/kraken/processor.ts');
    return new KrakenProcessor();
  }

  /**
   * Create KuCoin processor.
   */
  private static async createKucoinProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { KucoinProcessor } = await import('../../exchanges/kucoin/processor.ts');
    return new KucoinProcessor();
  }

  /**
   * Create Ledger Live processor.
   */
  private static async createLedgerLiveProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { LedgerLiveProcessor } = await import('../../exchanges/ledgerlive/processor.ts');
    return new LedgerLiveProcessor();
  }

  /**
   * Create Polkadot processor.
   */
  private static async createPolkadotProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { PolkadotTransactionProcessor } = await import('../../blockchains/polkadot/transaction-processor.ts');
    return new PolkadotTransactionProcessor();
  }

  /**
   * Create Solana processor.
   */
  private static async createSolanaProcessor(): Promise<IProcessor> {
    // Dynamic import to avoid circular dependencies
    const { SolanaTransactionProcessor } = await import('../../blockchains/solana/transaction-processor.ts');
    return new SolanaTransactionProcessor();
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
