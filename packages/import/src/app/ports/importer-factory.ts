import type { IBlockchainProviderManager } from './blockchain-provider-manager.ts';
import type { IImporter } from './importers.ts';

/**
 * Port interface for creating importer instances.
 * Abstracts infrastructure factory from the application layer.
 */
export interface IImporterFactory {
  /**
   * Create an importer for the specified source.
   */
  create<T>(
    sourceId: string,
    sourceType: string,
    providerId: string | undefined,
    providerManager: IBlockchainProviderManager | undefined
  ): Promise<IImporter<T>>;

  /**
   * Check if an importer is available for the given source.
   */
  isSupported(sourceId: string, sourceType: string): boolean;
}
