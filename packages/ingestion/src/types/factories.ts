import type { ImportSessionMetadata, SourceType } from '@exitbook/core';

import type { IImporter, ImportParams } from './importers.ts';
import type { ITransactionProcessor } from './processors.ts';

/**
 * Interface for creating importer instances.
 * Handles dependency injection and source-specific instantiation.
 */
export interface IImporterFactory {
  /**
   * Create an importer for the given source.
   *
   * @param sourceId - The source identifier (e.g., 'bitcoin', 'kraken')
   * @param sourceType - Whether this is a blockchain or exchange source
   * @param params - Import parameters (may contain provider preferences)
   * @returns The configured importer instance, or undefined if no importer exists
   */
  create(sourceId: string, sourceType: SourceType, params: ImportParams): Promise<IImporter | undefined>;
}

/**
 * Interface for creating processor instances.
 * Handles dependency injection and source-specific instantiation.
 */
export interface IProcessorFactory {
  /**
   * Create a processor for the given source.
   *
   * @param sourceId - The source identifier (e.g., 'bitcoin', 'kraken')
   * @param sourceType - Whether this is a blockchain or exchange source
   * @param metadata - Session metadata that may influence processor behavior
   * @returns The configured processor instance
   */
  create(sourceId: string, sourceType: SourceType, metadata: ImportSessionMetadata): Promise<ITransactionProcessor>;
}
