import type { IBlockchainAdapter } from '@crypto/core';
import { getLogger } from '@crypto/shared-logger';
import { AvalancheAdapter } from '../avalanche/adapter.ts';
import { BitcoinAdapter } from '../bitcoin/adapter.ts';
import { EthereumAdapter } from '../ethereum/adapter.ts';
import { InjectiveAdapter } from '../injective/adapter.ts';
import { SubstrateAdapter } from '../polkadot/adapter.ts';
import { SolanaAdapter } from '../solana/adapter.ts';
import type { BlockchainExplorersConfig } from './explorer-config.ts';

/**
 * Specialized factory for creating blockchain adapters
 */
export class BlockchainAdapterFactory {
  private logger = getLogger('BlockchainAdapterFactory');

  /**
   * Create a blockchain adapter based on configuration
   */
  async createBlockchainAdapter(
    blockchain: string,
    explorerConfig: BlockchainExplorersConfig
  ): Promise<IBlockchainAdapter> {
    this.logger.info(`Creating blockchain adapter for ${blockchain}`);

    switch (blockchain.toLowerCase()) {
      case 'bitcoin':
        return new BitcoinAdapter(explorerConfig);

      case 'ethereum':
        return new EthereumAdapter(explorerConfig);

      case 'injective':
        return new InjectiveAdapter(explorerConfig);

      case 'avalanche':
        return new AvalancheAdapter(explorerConfig);

      case 'bittensor':
      case 'polkadot':
      case 'kusama':
        return new SubstrateAdapter(explorerConfig);

      case 'solana':
        return new SolanaAdapter(explorerConfig);

      default:
        throw new Error(`Unsupported blockchain: ${blockchain}`);
    }
  }
}