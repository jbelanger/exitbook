import type { IImporter } from './importers.js';
import type { ITransactionProcessor } from './processors.js';

export interface ExchangeAdapter {
  exchange: string;
  createImporter: () => IImporter;
  createProcessor: () => ITransactionProcessor;
}

const adapters = new Map<string, ExchangeAdapter>();

export function registerExchange(config: ExchangeAdapter): void {
  adapters.set(config.exchange, config);
}

export function getExchangeAdapter(exchange: string): ExchangeAdapter | undefined {
  return adapters.get(exchange);
}

export function getAllExchanges(): string[] {
  return Array.from(adapters.keys()).sort();
}

export function hasExchangeAdapter(exchange: string): boolean {
  return adapters.has(exchange);
}

/**
 * Clear all registered exchange adapters.
 * Used for testing to avoid state leaking between test suites.
 */
export function clearExchangeAdapters(): void {
  adapters.clear();
}
