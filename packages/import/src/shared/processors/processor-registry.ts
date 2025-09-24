import type { IRawDataMapper } from './interfaces.js';

const transactionMapperMap = new Map<string, new () => IRawDataMapper<unknown>>();

/**
 * Decorator to register a mapper with a specific provider ID
 */
export function RegisterTransactionMapper(providerId: string) {
  return function (constructor: new () => IRawDataMapper<unknown>) {
    if (transactionMapperMap.has(providerId)) {
      console.warn(`Mapper already registered for providerId: ${providerId}`);
    }
    transactionMapperMap.set(providerId, constructor);
  };
}

/**
 * Factory for creating mapper instances based on provider ID
 */
export class TransactionMapperFactory {
  /**
   * Clear all registered mappers (mainly for testing)
   */
  static clear(): void {
    transactionMapperMap.clear();
  }

  /**
   * Create a mapper instance for the given provider ID
   */
  static create(providerId: string): IRawDataMapper<unknown> | undefined {
    const MapperClass = transactionMapperMap.get(providerId);
    return MapperClass ? new MapperClass() : undefined;
  }

  /**
   * Get all registered provider IDs
   */
  static getRegisteredProviderIds(): string[] {
    return Array.from(transactionMapperMap.keys());
  }

  /**
   * Check if a mapper is registered for the given provider ID
   */
  static isRegistered(providerId: string): boolean {
    return transactionMapperMap.has(providerId);
  }
}
