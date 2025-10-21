import type { ITransactionProcessor } from './transaction-processor.interface.ts';

/**
 * Port interface for creating processor instances.
 * Abstracts infrastructure factory from the application layer.
 */
export interface IProcessorFactory {
  /**
   * Create a processor for the specified source.
   */
  create(sourceId: string, sourceType: string, metadata?: Record<string, unknown>): Promise<ITransactionProcessor>;
}
