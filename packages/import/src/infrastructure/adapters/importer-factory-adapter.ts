import type { BlockchainExplorersConfig } from '@crypto/shared-utils';

import type { IImporterFactory } from '../../app/ports/importer-factory.ts';
import type { IImporter } from '../../app/ports/importers.ts';
import { BlockchainProviderManager } from '../blockchains/shared/blockchain-provider-manager.ts';
import { ImporterFactory } from '../shared/importers/importer-factory.ts';

/**
 * Adapter that implements the IImporterFactory port using the concrete ImporterFactory implementation.
 * This bridges the application layer (ports) with the infrastructure layer.
 * Encapsulates all provider management concerns within the infrastructure layer.
 */
export class ImporterFactoryAdapter implements IImporterFactory {
  private providerManager: BlockchainProviderManager;

  constructor(explorerConfig?: BlockchainExplorersConfig) {
    this.providerManager = new BlockchainProviderManager(explorerConfig);
  }

  isSupported(sourceId: string, sourceType: string): boolean {
    return ImporterFactory.isSupported(sourceId, sourceType);
  }

  async create<T>(sourceId: string, sourceType: string, providerId?: string): Promise<IImporter<T>> {
    return ImporterFactory.create<T>(sourceId, sourceType, providerId, this.providerManager);
  }

  /**
   * Clean up resources when the factory is destroyed
   */
  destroy(): void {
    this.providerManager.destroy();
  }
}
