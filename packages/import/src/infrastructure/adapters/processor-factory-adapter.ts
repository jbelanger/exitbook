import type { IProcessorFactory } from '../../app/ports/processor-factory.ts';
import type { IProcessor } from '../../app/ports/processors.ts';
import { ProcessorFactory } from '../shared/processors/processor-factory.ts';

/**
 * Adapter that implements the IProcessorFactory port using the concrete ProcessorFactory implementation.
 * This bridges the application layer (ports) with the infrastructure layer.
 */
export class ProcessorFactoryAdapter implements IProcessorFactory {
  async create(sourceId: string, sourceType: string): Promise<IProcessor> {
    return ProcessorFactory.create(sourceId, sourceType);
  }
}
