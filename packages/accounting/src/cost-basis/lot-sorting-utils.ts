import { parseDecimal, type UniversalTransactionData } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { TransactionLink } from '../linking/types.js';

/**
 * Topological sort of transactions by link dependencies using Kahn's algorithm.
 *
 * Dependencies:
 *   - Transfer links: sourceTransactionId → targetTransactionId (target depends on source)
 *
 * Tie-breaking (stable, deterministic):
 *   1. Topological order (dependency-first)
 *   2. Datetime ASC (chronological)
 *   3. Transaction ID ASC (database insertion order)
 *
 * Cycle handling:
 *   - Detects cycles and returns error with explicit cycle path
 *   - True transaction cycles indicate invalid data (circular transfers impossible)
 *
 * @param transactions - Transactions to sort
 * @param links - Transaction links defining dependencies
 * @returns Result<sorted transactions, error with cycle details>
 */
export function sortTransactionsByDependency(
  transactions: UniversalTransactionData[],
  links: TransactionLink[]
): Result<UniversalTransactionData[], Error> {
  const logger = getLogger('lot-sorting-utils:sortTransactionsByDependency');

  // Build dependency graph
  const graph = new Map<number, Set<number>>(); // txId → [dependent txIds]
  const inDegree = new Map<number, number>();
  const txMap = new Map(transactions.map((tx) => [tx.id, tx]));
  const datetimeByTxId = new Map<number, number>();

  // Initialize nodes
  for (const tx of transactions) {
    const datetimeMs = Date.parse(tx.datetime);
    if (Number.isNaN(datetimeMs)) {
      return err(new Error(`Invalid datetime for transaction ${tx.id}: "${tx.datetime}"`));
    }

    graph.set(tx.id, new Set());
    inDegree.set(tx.id, 0);
    datetimeByTxId.set(tx.id, datetimeMs);
  }

  // Add edges from links (source → target)
  for (const link of links) {
    const source = link.sourceTransactionId;
    const target = link.targetTransactionId;

    // Only add edge if both txs in current batch and not self-referential
    if (txMap.has(source) && txMap.has(target) && source !== target) {
      const edges = graph.get(source)!;
      if (!edges.has(target)) {
        edges.add(target);
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm with deterministic tie-breaking
  const queue: number[] = [];
  for (const [txId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(txId);
    }
  }

  // Sort queue by (datetime ASC, txId ASC) for stable ordering
  queue.sort((a, b) => {
    const timeCompare = datetimeByTxId.get(a)! - datetimeByTxId.get(b)!;
    return timeCompare !== 0 ? timeCompare : a - b;
  });

  const sorted: number[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    // Process neighbors
    for (const neighbor of graph.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);

      if (newDegree === 0) {
        // Insert maintaining (datetime, txId) order
        let insertAt = queue.length;

        for (let i = 0; i < queue.length; i++) {
          const timeCompare = datetimeByTxId.get(neighbor)! - datetimeByTxId.get(queue[i]!)!;
          const shouldInsertHere = timeCompare < 0 || (timeCompare === 0 && neighbor < queue[i]!);

          if (shouldInsertHere) {
            insertAt = i;
            break;
          }
        }

        queue.splice(insertAt, 0, neighbor);
      }
    }
  }

  // Detect cycles
  if (sorted.length < transactions.length) {
    const cycleNodes = transactions.map((tx) => tx.id).filter((id) => !sorted.includes(id));

    // Find cycle path for better diagnostics
    const cyclePath = findCyclePath(cycleNodes, graph);

    logger.error(
      { cycleNodes, cyclePath, totalTxs: transactions.length, sortedCount: sorted.length },
      'Transaction dependency cycle detected'
    );

    return err(
      new Error(
        `Transaction dependency cycle detected: ${cyclePath.join(' → ')}. ` +
          `This indicates circular transfer relationships, which should not exist in valid data. ` +
          `Check transaction links for data integrity issues.`
      )
    );
  }

  // Return sorted transactions
  return ok(sorted.map((id) => txMap.get(id)!));
}

/**
 * Find a cycle path for diagnostic purposes using DFS.
 *
 * @param cycleNodes - Transaction IDs that are part of the cycle
 * @param graph - Dependency graph
 * @returns Array of transaction IDs forming a cycle path
 */
function findCyclePath(cycleNodes: number[], graph: Map<number, Set<number>>): number[] {
  const visited = new Set<number>();
  const recStack = new Set<number>();
  const path: number[] = [];

  function dfs(node: number): boolean {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        // Found cycle - trim path to just the cycle
        const cycleStart = path.indexOf(neighbor);
        path.splice(0, cycleStart);
        path.push(neighbor); // Close the cycle
        return true;
      }
    }

    recStack.delete(node);
    path.pop();
    return false;
  }

  for (const node of cycleNodes) {
    if (!visited.has(node)) {
      if (dfs(node)) return path;
    }
  }

  return cycleNodes; // Fallback if DFS doesn't find cycle
}

export function getVarianceTolerance(
  source: string,
  configOverride?: { error: number; warn: number }
): { error: Decimal; warn: Decimal } {
  const sourceTolerances: Record<string, { error: number; warn: number }> = {
    binance: { warn: 1.5, error: 5.0 },
    kucoin: { warn: 1.5, error: 5.0 },
    coinbase: { warn: 1.0, error: 3.0 },
    kraken: { warn: 0.5, error: 2.0 },
    default: { warn: 1.0, error: 3.0 },
  };

  const sourceLower = source.toLowerCase();
  const baseTolerance = sourceTolerances[sourceLower] ?? sourceTolerances['default']!;
  const finalTolerance = configOverride ?? baseTolerance;

  return {
    warn: parseDecimal(finalTolerance.warn),
    error: parseDecimal(finalTolerance.error),
  };
}
