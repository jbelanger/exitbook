import { getLogger } from '@crypto/shared-logger';

import type { ETLComponentConfig } from '../common/interfaces.ts';
import type { IProcessor } from './interfaces.ts';

/**
 * Factory for creating processor instances.
 * Handles dependency injection and adapter-specific instantiation.
 */
export class ProcessorFactory {
  private static readonly logger = getLogger('ProcessorFactory');

  /**
   * Create a processor for the specified adapter.
   */
  static async create<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    const { adapterId, adapterType } = config;

    ProcessorFactory.logger.info(`Creating processor for ${adapterId} (type: ${adapterType})`);

    if (adapterType === 'exchange') {
      return await ProcessorFactory.createExchangeProcessor<T>(config);
    }

    if (adapterType === 'blockchain') {
      return await ProcessorFactory.createBlockchainProcessor<T>(config);
    }

    throw new Error(`Unsupported adapter type: ${adapterType}`);
  }

  /**
   * Create Bitcoin processor - placeholder for future implementation.
   */
  private static async createBitcoinProcessor<T>(_config: ETLComponentConfig): Promise<IProcessor<T>> {
    throw new Error('BitcoinProcessor not yet implemented');
  }

  /**
   * Create a blockchain processor.
   */
  private static async createBlockchainProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    const { adapterId } = config;

    switch (adapterId.toLowerCase()) {
      case 'bitcoin':
        return await ProcessorFactory.createBitcoinProcessor<T>(config);

      case 'ethereum':
        return await ProcessorFactory.createEthereumProcessor<T>(config);

      default:
        throw new Error(`Unsupported blockchain processor: ${adapterId}`);
    }
  }

  /**
   * Create Coinbase processor - placeholder for future implementation.
   */
  private static async createCoinbaseProcessor<T>(_config: ETLComponentConfig): Promise<IProcessor<T>> {
    throw new Error('CoinbaseProcessor not yet implemented');
  }

  /**
   * Create Ethereum processor - placeholder for future implementation.
   */
  private static async createEthereumProcessor<T>(_config: ETLComponentConfig): Promise<IProcessor<T>> {
    throw new Error('EthereumProcessor not yet implemented');
  }

  /**
   * Create an exchange processor.
   */
  private static async createExchangeProcessor<T>(config: ETLComponentConfig): Promise<IProcessor<T>> {
    const { adapterId } = config;

    switch (adapterId.toLowerCase()) {
      case 'kraken':
        return await ProcessorFactory.createKrakenProcessor<T>(config);

      case 'coinbase':
        return await ProcessorFactory.createCoinbaseProcessor<T>(config);

      default:
        throw new Error(`Unsupported exchange processor: ${adapterId}`);
    }
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
   * Get all supported adapters for a given type.
   */
  static getSupportedAdapters(adapterType: 'exchange' | 'blockchain'): string[] {
    if (adapterType === 'exchange') {
      return ['kraken', 'coinbase'];
    }

    if (adapterType === 'blockchain') {
      return ['bitcoin', 'ethereum'];
    }

    return [];
  }

  /**
   * Check if a processor is available for the given adapter.
   */
  static isSupported(adapterId: string, adapterType: string): boolean {
    try {
      if (adapterType === 'exchange') {
        return ['kraken', 'coinbase'].includes(adapterId.toLowerCase());
      }

      if (adapterType === 'blockchain') {
        return ['bitcoin', 'ethereum'].includes(adapterId.toLowerCase());
      }

      return false;
    } catch {
      return false;
    }
  }
}
