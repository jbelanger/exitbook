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
  /** Secondary source index keyed by (txId, assetId) without amount — fallback for UTXO adjusted amounts */
  private sourceByTxAssetMap: Map<string, TransactionLink[]>;
  private targetMap: Map<string, TransactionLink[]>;

  constructor(links: TransactionLink[]) {
    this.sourceMap = new Map();
    this.sourceByTxAssetMap = new Map();
    this.targetMap = new Map();

    for (const link of links) {
      const sourceKey = this.buildSourceKey(link.sourceTransactionId, link.sourceAssetId, link.sourceAmount);
      const sourceTxAssetKey = buildTxAssetKey(link.sourceTransactionId, link.sourceAssetId);
      const targetKey = buildTxAssetKey(link.targetTransactionId, link.targetAssetId);

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
   * Returns first available link matching txId + assetId + amount.
   */
  findBySource(txId: number, assetId: string, amount: Decimal): TransactionLink | undefined {
    const key = this.buildSourceKey(txId, assetId, amount);
    const links = this.sourceMap.get(key);
    return links && links.length > 0 ? (links[0] ?? undefined) : undefined;
  }

  /**
   * Find next unconsumed link for a source outflow transaction by txId + assetId only.
   * Fallback for UTXO transactions where link sourceAmount is an adjusted amount
   * (gross minus internal change) that doesn't match any movement amount.
   */
  findAnyBySource(txId: number, assetId: string): TransactionLink | undefined {
    const key = buildTxAssetKey(txId, assetId);
    const links = this.sourceByTxAssetMap.get(key);
    return links && links.length > 0 ? (links[0] ?? undefined) : undefined;
  }

  /**
   * Find next unconsumed link for a target inflow transaction.
   * Returns first available link matching txId + assetId.
   */
  findByTarget(txId: number, assetId: string): TransactionLink | undefined {
    const key = buildTxAssetKey(txId, assetId);
    const links = this.targetMap.get(key);
    return links && links.length > 0 ? (links[0] ?? undefined) : undefined;
  }

  /**
   * Mark link as consumed from source side.
   * Removes link from sourceMap and sourceByTxAssetMap but leaves it in targetMap for inflow processing.
   */
  consumeSourceLink(link: TransactionLink): void {
    const key = this.buildSourceKey(link.sourceTransactionId, link.sourceAssetId, link.sourceAmount);
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

    const txAssetKey = buildTxAssetKey(link.sourceTransactionId, link.sourceAssetId);
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
    const key = buildTxAssetKey(link.targetTransactionId, link.targetAssetId);
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

  private buildSourceKey(txId: number, assetId: string, amount: Decimal): string {
    return `${txId}:${assetId}:${amount.toFixed()}`;
  }
}

/**
 * Build key from transaction ID and asset ID (no amount).
 * Used for target lookups and fallback source lookups.
 */
function buildTxAssetKey(txId: number, assetId: string): string {
  return `${txId}:${assetId}`;
}
