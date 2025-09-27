import type { IBlockchainNormalizer } from '../../../app/ports/blockchain-normalizers.ts';
import { BitcoinNormalizer } from '../../blockchains/bitcoin/normalizer.js';
import type { BitcoinTransaction, NormalizedBitcoinTransaction } from '../../blockchains/bitcoin/types.js';

/**
 * Factory for creating blockchain-specific normalizers
 */
export class NormalizerFactory {
  /**
   * Create a normalizer for the specified blockchain
   */
  static createBitcoinNormalizer(): IBlockchainNormalizer<BitcoinTransaction, NormalizedBitcoinTransaction> {
    return new BitcoinNormalizer();
  }

  /**
   * Create normalizer by blockchain name (for dynamic creation)
   */
  static create(blockchain: string): IBlockchainNormalizer<unknown, unknown> {
    switch (blockchain.toLowerCase()) {
      case 'bitcoin':
        return NormalizerFactory.createBitcoinNormalizer();
      default:
        throw new Error(`Unsupported blockchain: ${blockchain}`);
    }
  }
}
