import type { Decimal } from 'decimal.js';

import type { TransactionLink } from './types.js';

/**
 * In-memory index for efficient transaction link lookups with support for batched withdrawals.
 *
 * Provides two-phase consumption:
 * - Source-side: Mark link as consumed during outflow processing (removes from sourceMap)
 * - Target-side: Mark link as consumed during inflow processing (removes from targetMap)
 *
 * This allows multiple outflows from a batched withdrawal to process their links
 * while keeping the inflow-side links available until the corresponding inflow is processed.
 */
export class LinkIndex {
  private sourceMap: Map<string, TransactionLink[]>;
  private targetMap: Map<string, TransactionLink[]>;

  constructor(links: TransactionLink[]) {
    this.sourceMap = new Map();
    this.targetMap = new Map();

    for (const link of links) {
      const sourceKey = this.buildSourceKey(link.sourceTransactionId, link.assetSymbol, link.sourceAmount);
      const targetKey = buildTargetKey(link.targetTransactionId, link.assetSymbol);

      if (!this.sourceMap.has(sourceKey)) {
        this.sourceMap.set(sourceKey, []);
      }
      this.sourceMap.get(sourceKey)!.push(link);

      if (!this.targetMap.has(targetKey)) {
        this.targetMap.set(targetKey, []);
      }
      this.targetMap.get(targetKey)!.push(link);
    }
  }

  /**
   * Find next unconsumed link for a source outflow transaction.
   * Returns first available link matching txId + asset + amount.
   */
  findBySource(txId: number, assetSymbol: string, amount: Decimal): TransactionLink | undefined {
    const key = this.buildSourceKey(txId, assetSymbol, amount);
    const links = this.sourceMap.get(key);
    return links && links.length > 0 ? (links[0] ?? undefined) : undefined;
  }

  /**
   * Find next unconsumed link for a target inflow transaction.
   * Returns first available link matching txId + asset.
   */
  findByTarget(txId: number, assetSymbol: string): TransactionLink | undefined {
    const key = buildTargetKey(txId, assetSymbol);
    const links = this.targetMap.get(key);
    return links && links.length > 0 ? (links[0] ?? undefined) : undefined;
  }

  /**
   * Mark link as consumed from source side.
   * Removes link from sourceMap but leaves it in targetMap for inflow processing.
   */
  consumeSourceLink(link: TransactionLink): void {
    const key = this.buildSourceKey(link.sourceTransactionId, link.assetSymbol, link.sourceAmount);
    const links = this.sourceMap.get(key);
    if (links) {
      const index = links.findIndex((l) => l.id === link.id);
      if (index !== -1) {
        links.splice(index, 1);
        if (links.length === 0) {
          this.sourceMap.delete(key);
        }
      }
    }
  }

  /**
   * Mark link as consumed from target side.
   * Removes link from targetMap after inflow processing.
   */
  consumeTargetLink(link: TransactionLink): void {
    const key = buildTargetKey(link.targetTransactionId, link.assetSymbol);
    const links = this.targetMap.get(key);
    if (links) {
      const index = links.findIndex((l) => l.id === link.id);
      if (index !== -1) {
        links.splice(index, 1);
        if (links.length === 0) {
          this.targetMap.delete(key);
        }
      }
    }
  }

  private buildSourceKey(txId: number, assetSymbol: string, amount: Decimal): string {
    return `${txId}:${assetSymbol}:${amount.toFixed()}`;
  }
}

/**
 * Build target key for looking up links by target transaction and asset.
 */
function buildTargetKey(txId: number, assetSymbol: string): string {
  return `${txId}:${assetSymbol}`;
}
