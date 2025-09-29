import type { IProcessor } from './processors.ts';

/**
 * Port interface for creating processor instances.
 * Abstracts infrastructure factory from the application layer.
 */
export interface IProcessorFactory {
  /**
   * Create a processor for the specified source.
   */
  create(sourceId: string, sourceType: string): Promise<IProcessor>;
}
