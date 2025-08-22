import type { IUniversalAdapter } from '@crypto/core';
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
  ): Promise<IUniversalAdapter> {
    this.logger.info(`Creating blockchain adapter for ${blockchain}`);

    switch (blockchain.toLowerCase()) {
      case 'bitcoin':
        const bitcoinConfig = {
          type: 'blockchain' as const,
          id: 'bitcoin',
          subType: 'rest' as const,
          network: 'mainnet'
        };
        return new BitcoinAdapter(bitcoinConfig, explorerConfig);

      case 'ethereum':
        const ethereumConfig = {
          type: 'blockchain' as const,
          id: 'ethereum',
          subType: 'rest' as const,
          network: 'mainnet'
        };
        return new EthereumAdapter(ethereumConfig, explorerConfig);

      case 'injective':
        const injectiveConfig = {
          type: 'blockchain' as const,
          id: 'injective',
          subType: 'rest' as const,
          network: 'mainnet'
        };
        return new InjectiveAdapter(injectiveConfig, explorerConfig);

      case 'avalanche':
        const avalancheConfig = {
          type: 'blockchain' as const,
          id: 'avalanche',
          subType: 'rest' as const,
          network: 'mainnet'
        };
        return new AvalancheAdapter(avalancheConfig, explorerConfig);

      case 'bittensor':
      case 'polkadot':
      case 'kusama':
        const substrateConfig = {
          type: 'blockchain' as const,
          id: blockchain.toLowerCase(),
          subType: 'rest' as const,
          network: 'mainnet'
        };
        return new SubstrateAdapter(substrateConfig, explorerConfig);

      case 'solana':
        const solanaConfig = {
          type: 'blockchain' as const,
          id: 'solana',
          subType: 'rest' as const,
          network: 'mainnet'
        };
        return new SolanaAdapter(solanaConfig, explorerConfig);

      default:
        throw new Error(`Unsupported blockchain: ${blockchain}`);
    }
  }
}