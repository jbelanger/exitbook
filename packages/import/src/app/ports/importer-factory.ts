import type { IImporter } from './importers.ts';

/**
 * Port interface for creating importer instances.
 * Abstracts infrastructure factory from the application layer.
 */
export interface IImporterFactory {
  /**
   * Create an importer for the specified source.
   * All provider management (selection, failover, circuit breaking) is handled by the infrastructure layer.
   */
  create<T>(sourceId: string, sourceType: string, providerId?: string): Promise<IImporter<T>>;

  /**
   * Check if an importer is available for the given source.
   */
  isSupported(sourceId: string, sourceType: string): boolean;
}
