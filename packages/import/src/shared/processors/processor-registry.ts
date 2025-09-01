import type { IRawDataMapper } from './interfaces.ts';

const processorMap = new Map<string, new () => IRawDataMapper<unknown>>();

/**
 * Decorator to register a processor with a specific provider ID
 */
export function RegisterProcessor(providerId: string) {
  return function (constructor: new () => IRawDataMapper<unknown>) {
    if (processorMap.has(providerId)) {
      console.warn(`Processor already registered for providerId: ${providerId}`);
    }
    processorMap.set(providerId, constructor);
  };
}

/**
 * Factory for creating processor instances based on provider ID
 */
export class ProcessorFactory {
  /**
   * Clear all registered processors (mainly for testing)
   */
  static clear(): void {
    processorMap.clear();
  }

  /**
   * Create a processor instance for the given provider ID
   */
  static create(providerId: string): IRawDataMapper<unknown> | undefined {
    const ProcessorClass = processorMap.get(providerId);
    return ProcessorClass ? new ProcessorClass() : undefined;
  }

  /**
   * Get all registered provider IDs
   */
  static getRegisteredProviderIds(): string[] {
    return Array.from(processorMap.keys());
  }

  /**
   * Check if a processor is registered for the given provider ID
   */
  static isRegistered(providerId: string): boolean {
    return processorMap.has(providerId);
  }
}
