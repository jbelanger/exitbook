import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import type { NewTransactionLink, OutflowGrouping } from '../types.js';

/**
 * Build adjusted outflow amounts using blockchain_internal link clusters.
 *
 * When a cluster contains both outflows and inflows for the same asset, subtract
 * the internal inflow amounts from the outflow to approximate the external transfer
 * amount for matching.
 *
 * Only adjusts assets that have blockchain_internal links in the cluster.
 */
export function buildInternalOutflowAdjustments(
  transactions: UniversalTransactionData[],
  internalLinks: NewTransactionLink[],
  logger: Logger
): { adjustments: Map<number, Map<string, Decimal>>; outflowGroupings: OutflowGrouping[] } {
  const adjustments = new Map<number, Map<string, Decimal>>();
  const outflowGroupings: OutflowGrouping[] = [];
  let nonPositiveCount = 0;
  let adjustmentCount = 0;

  if (internalLinks.length === 0) {
    return { adjustments, outflowGroupings };
  }

  const transactionsById = new Map<number, UniversalTransactionData>();
  for (const tx of transactions) {
    transactionsById.set(tx.id, tx);
  }

  // Build adjacency graph AND track which assets are linked per transaction
  const adjacency = new Map<number, Set<number>>();
  const linkedAssetsPerTx = new Map<number, Set<string>>();

  for (const link of internalLinks) {
    if (link.linkType !== 'blockchain_internal') continue;
    const sourceId = link.sourceTransactionId;
    const targetId = link.targetTransactionId;

    if (!adjacency.has(sourceId)) adjacency.set(sourceId, new Set());
    if (!adjacency.has(targetId)) adjacency.set(targetId, new Set());
    adjacency.get(sourceId)?.add(targetId);
    adjacency.get(targetId)?.add(sourceId);

    if (!linkedAssetsPerTx.has(sourceId)) linkedAssetsPerTx.set(sourceId, new Set());
    if (!linkedAssetsPerTx.has(targetId)) linkedAssetsPerTx.set(targetId, new Set());
    linkedAssetsPerTx.get(sourceId)?.add(link.assetSymbol);
    linkedAssetsPerTx.get(targetId)?.add(link.assetSymbol);
  }

  // Find connected components (clusters) and merge linked assets
  const visited = new Set<number>();
  const clusters: { linkedAssets: Set<string>; txs: UniversalTransactionData[] }[] = [];

  for (const txId of adjacency.keys()) {
    if (visited.has(txId)) continue;
    const stack = [txId];
    const cluster: UniversalTransactionData[] = [];
    const linkedAssets = new Set<string>();
    visited.add(txId);

    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      const tx = transactionsById.get(current);
      if (tx) cluster.push(tx);

      const assetsForTx = linkedAssetsPerTx.get(current);
      if (assetsForTx) {
        for (const asset of assetsForTx) {
          linkedAssets.add(asset);
        }
      }

      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }

    if (cluster.length > 1) {
      clusters.push({ txs: cluster, linkedAssets });
    }
  }

  // Calculate adjustments only for assets that have blockchain_internal links
  for (const { txs: group, linkedAssets } of clusters) {
    const { inflowAmountsByTx, outflowAmountsByTx } = aggregateMovementsByTransaction(group);

    for (const assetSymbol of linkedAssets) {
      const result = calculateOutflowAdjustment(assetSymbol, group, inflowAmountsByTx, outflowAmountsByTx);

      if ('skip' in result) {
        if (result.skip === 'non-positive') {
          nonPositiveCount++;
          logger.debug({ assetSymbol }, 'Skipping internal outflow adjustment: adjusted amount is non-positive');
        }
        continue;
      }

      if (result.multipleOutflows) {
        logger.info(
          `Multiple outflows detected for ${assetSymbol} - summed all outflows and subtracted change | ` +
            `Representative TX: ${result.representativeTxId} | ` +
            `Group Members: [${result.groupMemberIds.join(', ')}] | ` +
            `Adjusted Amount: ${result.adjustedAmount.toFixed()}`
        );

        outflowGroupings.push({
          representativeTxId: result.representativeTxId,
          groupMemberIds: new Set(result.groupMemberIds),
          assetSymbol,
        });
      }

      const byAsset = adjustments.get(result.representativeTxId) ?? new Map<string, Decimal>();
      byAsset.set(assetSymbol, result.adjustedAmount);
      adjustments.set(result.representativeTxId, byAsset);
      adjustmentCount++;
    }
  }

  if (nonPositiveCount > 0) {
    logger.info({ adjustmentCount, nonPositiveCount }, 'Internal outflow adjustment summary');
  }

  return { adjustments, outflowGroupings };
}

/**
 * Aggregate inflow and outflow amounts by transaction and asset for a group.
 *
 * @param group - Transactions connected by blockchain_internal links
 * @returns Aggregated amounts and asset symbols
 */
function aggregateMovementsByTransaction(group: UniversalTransactionData[]): {
  inflowAmountsByTx: Map<number, Map<string, Decimal>>;
  outflowAmountsByTx: Map<number, Map<string, Decimal>>;
} {
  const inflowAmountsByTx = new Map<number, Map<string, Decimal>>();
  const outflowAmountsByTx = new Map<number, Map<string, Decimal>>();

  for (const tx of group) {
    const inflowMap = new Map<string, Decimal>();
    const outflowMap = new Map<string, Decimal>();

    for (const inflow of tx.movements.inflows ?? []) {
      const amount = parseDecimal(inflow.netAmount ?? inflow.grossAmount);
      const current = inflowMap.get(inflow.assetSymbol) ?? parseDecimal('0');
      inflowMap.set(inflow.assetSymbol, current.plus(amount));
    }

    for (const outflow of tx.movements.outflows ?? []) {
      const amount = parseDecimal(outflow.netAmount ?? outflow.grossAmount);
      const current = outflowMap.get(outflow.assetSymbol) ?? parseDecimal('0');
      outflowMap.set(outflow.assetSymbol, current.plus(amount));
    }

    if (inflowMap.size > 0) inflowAmountsByTx.set(tx.id, inflowMap);
    if (outflowMap.size > 0) outflowAmountsByTx.set(tx.id, outflowMap);
  }

  return { inflowAmountsByTx, outflowAmountsByTx };
}

/**
 * Calculate adjusted outflow amount for an asset by subtracting internal inflows and deduped fees.
 *
 * When a blockchain_internal cluster contains multiple wallet addresses involved in
 * related transactions, outflows may include internal transfers to other owned addresses.
 * This function identifies and subtracts those internal inflows to get the actual
 * external transfer amount for matching purposes.
 */
function calculateOutflowAdjustment(
  assetSymbol: string,
  group: UniversalTransactionData[],
  inflowAmountsByTx: Map<number, Map<string, Decimal>>,
  outflowAmountsByTx: Map<number, Map<string, Decimal>>
):
  | { adjustedAmount: Decimal; groupMemberIds: number[]; multipleOutflows: boolean; representativeTxId: number }
  | { skip: 'non-positive' | 'no-adjustment' } {
  const outflowTxs = group.filter((tx) => {
    const outflowMap = outflowAmountsByTx.get(tx.id);
    if (!outflowMap) return false;
    const amount = outflowMap.get(assetSymbol);
    return amount ? amount.gt(0) : false;
  });

  const inflowTxs = group.filter((tx) => {
    const inflowMap = inflowAmountsByTx.get(tx.id);
    if (!inflowMap) return false;
    const amount = inflowMap.get(assetSymbol);
    return amount ? amount.gt(0) : false;
  });

  if (outflowTxs.length === 0) return { skip: 'no-adjustment' };

  const multipleOutflows = outflowTxs.length > 1;
  if (inflowTxs.length === 0 && !multipleOutflows) return { skip: 'no-adjustment' };

  const sumGrossMovements = (movements: { assetSymbol: string; grossAmount: Decimal }[] | undefined): Decimal => {
    let total = parseDecimal('0');
    for (const movement of movements ?? []) {
      if (movement.assetSymbol !== assetSymbol) continue;
      total = total.plus(parseDecimal(movement.grossAmount));
    }
    return total;
  };

  let totalOutflows = parseDecimal('0');
  let selectedTx = outflowTxs[0];

  for (const tx of outflowTxs) {
    const amount = sumGrossMovements(tx.movements.outflows);
    if (amount.gt(0)) {
      totalOutflows = totalOutflows.plus(amount);
      if (!selectedTx || tx.id < selectedTx.id) {
        selectedTx = tx;
      }
    }
  }

  if (!selectedTx) return { skip: 'no-adjustment' };

  const groupMemberIds: number[] = outflowTxs.map((tx) => tx.id);

  let totalInternalInflows = parseDecimal('0');
  for (const inflowTx of inflowTxs) {
    const amount = sumGrossMovements(inflowTx.movements.inflows);
    if (amount.gt(0)) totalInternalInflows = totalInternalInflows.plus(amount);
  }

  // Deduplicate on-chain fees (per-address processors may record fee per address)
  let feeAmount = parseDecimal('0');
  for (const tx of group) {
    for (const fee of tx.fees ?? []) {
      if (fee.assetSymbol !== assetSymbol) continue;
      if (fee.settlement !== 'on-chain') continue;
      const amount = parseDecimal(fee.amount);
      if (amount.gt(feeAmount)) feeAmount = amount;
    }
  }

  const adjustedAmount = totalOutflows.minus(totalInternalInflows).minus(feeAmount);
  if (adjustedAmount.lte(0)) return { skip: 'non-positive' };

  return { representativeTxId: selectedTx.id, adjustedAmount, multipleOutflows, groupMemberIds };
}
