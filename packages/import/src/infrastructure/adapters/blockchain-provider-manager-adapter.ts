import type { IBlockchainProviderManager } from '../../app/ports/blockchain-provider-manager.ts';
import type { BlockchainProviderManager } from '../blockchains/shared/blockchain-provider-manager.ts';

/**
 * Adapter that implements the IBlockchainProviderManager port using the concrete BlockchainProviderManager implementation.
 * This bridges the application layer (ports) with the infrastructure layer.
 */
export class BlockchainProviderManagerAdapter implements IBlockchainProviderManager {
  constructor(private providerManager: BlockchainProviderManager) {}

  destroy(): void {
    this.providerManager.destroy?.();
  }
}
