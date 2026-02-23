import { err, ok, type Result } from 'neverthrow';

import type { BlockchainAdapter } from './blockchain-adapter.js';
import type { ExchangeAdapter } from './exchange-adapter.js';

function buildMap<T>(adapters: T[], keyFn: (a: T) => string): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const adapter of adapters) {
    const key = keyFn(adapter);
    if (map.has(key)) {
      throw new Error(`Duplicate adapter registration: "${key}"`);
    }
    map.set(key, adapter);
  }
  return map;
}

export class AdapterRegistry {
  private readonly blockchains: ReadonlyMap<string, BlockchainAdapter>;
  private readonly exchanges: ReadonlyMap<string, ExchangeAdapter>;

  constructor(blockchainAdapters: BlockchainAdapter[], exchangeAdapters: ExchangeAdapter[]) {
    this.blockchains = buildMap(blockchainAdapters, (a) => a.blockchain);
    this.exchanges = buildMap(exchangeAdapters, (a) => a.exchange);
  }

  getBlockchain(name: string): Result<BlockchainAdapter, Error> {
    const adapter = this.blockchains.get(name);
    if (!adapter) return err(new Error(`Unknown blockchain: ${name}`));
    return ok(adapter);
  }

  getExchange(name: string): Result<ExchangeAdapter, Error> {
    const adapter = this.exchanges.get(name);
    if (!adapter) return err(new Error(`Unknown exchange: ${name}`));
    return ok(adapter);
  }

  getAllBlockchains(): string[] {
    return Array.from(this.blockchains.keys()).sort();
  }

  getAllExchanges(): string[] {
    return Array.from(this.exchanges.keys()).sort();
  }

  hasBlockchain(name: string): boolean {
    return this.blockchains.has(name);
  }

  hasExchange(name: string): boolean {
    return this.exchanges.has(name);
  }
}
