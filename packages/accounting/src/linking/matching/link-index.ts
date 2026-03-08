import type { Decimal } from 'decimal.js';

import type { TransactionLink } from '../shared/types.js';

/**
 * In-memory index for efficient transaction link lookups with support for
 * batched and partial transfers.
 *
 * All keys use assetSymbol (not venue-scoped assetId) because linking is cross-venue:
 * a withdrawal from an exchange and a deposit on a blockchain share the same symbol.
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
  /** Secondary source index keyed by (txId, assetSymbol) for grouped source lookups. */
  private sourceByTxAssetMap: Map<string, TransactionLink[]>;
  private targetMap: Map<string, TransactionLink[]>;

  constructor(links: TransactionLink[]) {
    this.sourceMap = new Map();
    this.sourceByTxAssetMap = new Map();
    this.targetMap = new Map();

    for (const link of links) {
      const sourceKey = this.buildSourceKey(link.sourceTransactionId, link.assetSymbol, link.sourceAmount);
      const sourceTxAssetKey = buildTxAssetKey(link.sourceTransactionId, link.assetSymbol);
      const targetKey = buildTxAssetKey(link.targetTransactionId, link.assetSymbol);

      if (!this.sourceMap.has(sourceKey)) {
        this.sourceMap.set(sourceKey, []);
      }
      this.sourceMap.get(sourceKey)!.push(link);

      if (!this.sourceByTxAssetMap.has(sourceTxAssetKey)) {
        this.sourceByTxAssetMap.set(sourceTxAssetKey, []);
      }
      this.sourceByTxAssetMap.get(sourceTxAssetKey)!.push(link);

      if (!this.targetMap.has(targetKey)) {
        this.targetMap.set(targetKey, []);
      }
      this.targetMap.get(targetKey)!.push(link);
    }
  }

  /**
   * Find next unconsumed link for a source outflow transaction.
   * Returns first available link matching txId + assetSymbol + amount.
   */
  findBySource(txId: number, assetSymbol: string, amount: Decimal): TransactionLink | undefined {
    const key = this.buildSourceKey(txId, assetSymbol, amount);
    const links = this.sourceMap.get(key);
    return links && links.length > 0 ? (links[0] ?? undefined) : undefined;
  }

  /**
   * Find next unconsumed link for a target inflow transaction.
   * Returns first available link matching txId + assetSymbol.
   */
  findByTarget(txId: number, assetSymbol: string): TransactionLink | undefined {
    const key = buildTxAssetKey(txId, assetSymbol);
    const links = this.targetMap.get(key);
    return links && links.length > 0 ? (links[0] ?? undefined) : undefined;
  }

  /**
   * Find all unconsumed links for a source outflow transaction by txId + assetSymbol.
   * Returns all links (supports 1:N partial matches where one source has multiple links).
   */
  findAllBySource(txId: number, assetSymbol: string): TransactionLink[] {
    const key = buildTxAssetKey(txId, assetSymbol);
    return this.sourceByTxAssetMap.get(key) ?? [];
  }

  /**
   * Find all unconsumed links for a target inflow transaction by txId + assetSymbol.
   * Returns all links (supports N:1 partial matches where one target has multiple links).
   */
  findAllByTarget(txId: number, assetSymbol: string): TransactionLink[] {
    const key = buildTxAssetKey(txId, assetSymbol);
    return this.targetMap.get(key) ?? [];
  }

  /**
   * Mark link as consumed from source side.
   * Removes link from sourceMap and sourceByTxAssetMap but leaves it in targetMap for inflow processing.
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

    const txAssetKey = buildTxAssetKey(link.sourceTransactionId, link.assetSymbol);
    const txAssetLinks = this.sourceByTxAssetMap.get(txAssetKey);
    if (txAssetLinks) {
      const index = txAssetLinks.findIndex((l) => l.id === link.id);
      if (index !== -1) {
        txAssetLinks.splice(index, 1);
        if (txAssetLinks.length === 0) {
          this.sourceByTxAssetMap.delete(txAssetKey);
        }
      }
    }
  }

  /**
   * Mark link as consumed from target side.
   * Removes link from targetMap after inflow processing.
   */
  consumeTargetLink(link: TransactionLink): void {
    const key = buildTxAssetKey(link.targetTransactionId, link.assetSymbol);
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
 * Build key from transaction ID and asset symbol (no amount).
 * Used for target lookups and grouped source lookups.
 */
function buildTxAssetKey(txId: number, assetSymbol: string): string {
  return `${txId}:${assetSymbol}`;
}
