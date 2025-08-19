import type {
  IBlockchainAdapter
} from '../../core/types/index';
import { Logger } from '../../infrastructure/logging';

import { AvalancheAdapter } from './avalanche-adapter';
import { BitcoinAdapter } from './bitcoin-adapter';
import { EthereumAdapter } from './ethereum-adapter';
import { InjectiveAdapter } from './injective-adapter';
import { SolanaAdapter } from './solana-adapter';
import { SubstrateAdapter } from './substrate-adapter';

/**
 * Specialized factory for creating blockchain adapters
 */
export class BlockchainAdapterFactory {
  private logger = new Logger('BlockchainAdapterFactory');

  /**
   * Create a blockchain adapter based on configuration
   */
  async createBlockchainAdapter(
    blockchain: string
  ): Promise<IBlockchainAdapter> {
    this.logger.info(`Creating blockchain adapter for ${blockchain}`);

    switch (blockchain.toLowerCase()) {
      case 'bitcoin':
        return new BitcoinAdapter();

      case 'ethereum':
        return new EthereumAdapter();

      case 'injective':
        return new InjectiveAdapter();

      case 'avalanche':
        return new AvalancheAdapter();

      case 'bittensor':
      case 'polkadot':
      case 'kusama':
        return new SubstrateAdapter();

      case 'solana':
        return new SolanaAdapter();

      default:
        throw new Error(`Unsupported blockchain: ${blockchain}`);
    }
  }
}