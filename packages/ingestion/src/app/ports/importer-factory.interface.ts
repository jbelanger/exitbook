import type { IImporter, ImportParams } from './importers.ts';

/**
 * Port interface for creating importer instances.
 * Abstracts infrastructure factory from the application layer.
 */
export interface IImporterFactory {
  /**
   * Create an importer for the specified source.
   * All provider management (selection, failover, circuit breaking) is handled by the infrastructure layer.
   */
  create(sourceId: string, sourceType: string, params?: ImportParams): Promise<IImporter> | undefined;
}
