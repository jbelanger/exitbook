import type { IBlockchainProviderManager } from '../../app/ports/blockchain-provider-manager.ts';
import type { IImporterFactory } from '../../app/ports/importer-factory.ts';
import type { IImporter } from '../../app/ports/importers.ts';
import type { BlockchainProviderManager } from '../blockchains/shared/blockchain-provider-manager.ts';
import { ImporterFactory } from '../shared/importers/importer-factory.ts';

/**
 * Adapter that implements the IImporterFactory port using the concrete ImporterFactory implementation.
 * This bridges the application layer (ports) with the infrastructure layer.
 */
export class ImporterFactoryAdapter implements IImporterFactory {
  isSupported(sourceId: string, sourceType: string): boolean {
    return ImporterFactory.isSupported(sourceId, sourceType);
  }

  async create<T>(
    sourceId: string,
    sourceType: string,
    providerId: string | undefined,
    providerManager: IBlockchainProviderManager | undefined
  ): Promise<IImporter<T>> {
    // Cast the port interface back to the concrete implementation for the factory
    const concreteProviderManager = providerManager as BlockchainProviderManager | undefined;
    return ImporterFactory.create<T>(sourceId, sourceType, providerId, concreteProviderManager);
  }
}
