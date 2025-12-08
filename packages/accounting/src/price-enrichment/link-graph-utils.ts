import { randomUUID } from 'node:crypto';

import type { UniversalTransactionData } from '@exitbook/core';

import type { TransactionLink } from '../linking/types.js';

import type { TransactionGroup } from './types.js';

/**
 * Union-Find (Disjoint Set Union) data structure
 * Used to efficiently group transitively linked transactions
 *
 * Time Complexity:
 * - find: O(α(n)) ≈ O(1) amortized (with path compression)
 * - union: O(α(n)) ≈ O(1) amortized (with union by rank)
 * where α is the inverse Ackermann function (grows extremely slowly)
 */
class UnionFind {
  private parent: Map<number, number>;
  private rank: Map<number, number>;

  constructor(elements: number[]) {
    this.parent = new Map(elements.map((e) => [e, e]));
    this.rank = new Map(elements.map((e) => [e, 0]));
  }

  /**
   * Find the root representative of the set containing element x
   * Uses path compression: makes all nodes on the path point directly to the root
   */
  find(x: number): number {
    const parentX = this.parent.get(x);
    if (parentX === undefined) {
      throw new Error(`Element ${x} not found in UnionFind structure`);
    }

    if (parentX !== x) {
      // Path compression: recursively find root and update parent
      this.parent.set(x, this.find(parentX));
    }

    return this.parent.get(x)!;
  }

  /**
   * Unite the sets containing elements x and y
   * Uses union by rank: attaches smaller tree under root of larger tree
   */
  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX === rootY) {
      // Already in the same set
      return;
    }

    const rankX = this.rank.get(rootX)!;
    const rankY = this.rank.get(rootY)!;

    if (rankX < rankY) {
      // Tree Y is taller, attach X under Y
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      // Tree X is taller, attach Y under X
      this.parent.set(rootY, rootX);
    } else {
      // Equal rank, attach Y under X and increment X's rank
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }

  /**
   * Get all unique root representatives (one per disjoint set)
   */
  getRoots(): Set<number> {
    const roots = new Set<number>();
    for (const element of this.parent.keys()) {
      roots.add(this.find(element));
    }
    return roots;
  }
}

/**
 * Build transaction groups from links using Union-Find algorithm
 *
 * Algorithm:
 * 1. Initialize Union-Find with all transaction IDs
 * 2. Seed: Union transactions from the same EXCHANGE (preserves Phase 1 backward compatibility)
 *    - Exchange transactions (Kraken, Coinbase, etc.) grouped by source
 *    - Blockchain transactions (Bitcoin, Ethereum, etc.) remain isolated
 *    - Rationale: Exchanges = single user's activity; Blockchains = multiple wallets
 * 3. Enhance: Union confirmed cross-platform links (adds Phase 2 functionality)
 *    - Links connect related transactions across platforms
 * 4. Group transactions by their root representative
 * 5. Build TransactionGroup objects with metadata
 *
 * Time Complexity: O(n log n) where n is the number of transactions
 *
 * Security: Prevents price leakage across unrelated wallets on same blockchain
 *
 * @param transactions - All transactions to group
 * @param links - Transaction links (only confirmed links are used)
 * @returns Array of transaction groups
 */
export function buildLinkGraph(transactions: UniversalTransactionData[], links: TransactionLink[]): TransactionGroup[] {
  // Handle empty input
  if (transactions.length === 0) {
    return [];
  }

  // Initialize Union-Find with all transaction IDs
  const transactionIds = transactions.map((tx) => tx.id);
  const transactionIdSet = new Set(transactionIds);
  const uf = new UnionFind(transactionIds);

  // SEED: Union transactions from the same EXCHANGE source (Phase 1 backward compatibility)
  // IMPORTANT: Only group EXCHANGE transactions, NOT blockchain transactions
  // Rationale:
  // - Exchanges: All activity belongs to one user → safe to group together
  // - Blockchains: Multiple wallets possible → must NOT group together
  // Example: Bitcoin chain can have wallet A (tx1, tx2) and wallet B (tx3, tx4)
  //          Grouping all bitcoin txs would leak prices from wallet A to wallet B
  const txsByExchange = new Map<string, number[]>();
  for (const tx of transactions) {
    // Only group if this is an exchange transaction (not blockchain)
    const isBlockchain = 'blockchain' in tx && tx.blockchain !== undefined;
    if (!isBlockchain) {
      if (!txsByExchange.has(tx.source)) {
        txsByExchange.set(tx.source, []);
      }
      txsByExchange.get(tx.source)!.push(tx.id);
    }
  }

  // Union all transactions within each exchange
  for (const txIds of txsByExchange.values()) {
    if (txIds.length > 1) {
      // Connect all transactions to the first one in the exchange
      const firstId = txIds[0]!;
      for (let i = 1; i < txIds.length; i++) {
        uf.union(firstId, txIds[i]!);
      }
    }
  }

  // ENHANCE: Then, union confirmed cross-platform links (Phase 2 functionality)
  // This enables price propagation across different sources (exchange ↔ blockchain)
  for (const link of links) {
    if (link.status === 'confirmed') {
      // Check that both transactions exist in our transaction set (O(1) lookup with Set)
      const hasSource = transactionIdSet.has(link.sourceTransactionId);
      const hasTarget = transactionIdSet.has(link.targetTransactionId);

      if (hasSource && hasTarget) {
        uf.union(link.sourceTransactionId, link.targetTransactionId);
      }
    }
  }

  // Group transactions by their root representative
  const groups = new Map<number, UniversalTransactionData[]>();
  for (const tx of transactions) {
    const root = uf.find(tx.id);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(tx);
  }

  // Convert to TransactionGroup objects with metadata
  return Array.from(groups.values()).map((groupTransactions) => {
    const groupId = randomUUID();
    const sources = new Set(groupTransactions.map((tx) => tx.source));
    const linkChain = extractGroupLinks(groupTransactions, links);

    return {
      groupId,
      transactions: groupTransactions,
      sources,
      linkChain,
    };
  });
}

/**
 * Extract all confirmed links that connect transactions within a group
 */
function extractGroupLinks(
  groupTransactions: UniversalTransactionData[],
  allLinks: TransactionLink[]
): TransactionLink[] {
  const groupTxIds = new Set(groupTransactions.map((tx) => tx.id));

  return allLinks.filter(
    (link) =>
      link.status === 'confirmed' &&
      groupTxIds.has(link.sourceTransactionId) &&
      groupTxIds.has(link.targetTransactionId)
  );
}
