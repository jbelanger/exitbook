import type { UniversalTransactionData } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import type { OutflowGrouping, TransactionCandidate } from './types.js';

/**
 * Aggregate inflow and outflow amounts by transaction and asset for a group.
 *
 * @param group - Transactions connected by blockchain_internal links
 * @returns Aggregated amounts and asset symbols
 */
export function aggregateMovementsByTransaction(group: UniversalTransactionData[]): {
  assetIds: Set<string>;
  inflowAmountsByTx: Map<number, Map<string, Decimal>>;
  outflowAmountsByTx: Map<number, Map<string, Decimal>>;
} {
  const inflowAmountsByTx = new Map<number, Map<string, Decimal>>();
  const outflowAmountsByTx = new Map<number, Map<string, Decimal>>();
  const assetIds = new Set<string>();

  for (const tx of group) {
    const inflowMap = new Map<string, Decimal>();
    const outflowMap = new Map<string, Decimal>();

    for (const inflow of tx.movements.inflows ?? []) {
      const amount = parseDecimal(inflow.netAmount ?? inflow.grossAmount);
      const current = inflowMap.get(inflow.assetId) ?? parseDecimal('0');
      inflowMap.set(inflow.assetId, current.plus(amount));
      assetIds.add(inflow.assetId);
    }

    for (const outflow of tx.movements.outflows ?? []) {
      const amount = parseDecimal(outflow.netAmount ?? outflow.grossAmount);
      const current = outflowMap.get(outflow.assetId) ?? parseDecimal('0');
      outflowMap.set(outflow.assetId, current.plus(amount));
      assetIds.add(outflow.assetId);
    }

    if (inflowMap.size > 0) inflowAmountsByTx.set(tx.id, inflowMap);
    if (outflowMap.size > 0) outflowAmountsByTx.set(tx.id, outflowMap);
  }

  return { inflowAmountsByTx, outflowAmountsByTx, assetIds };
}

/**
 * Calculate adjusted outflow amount for an asset by subtracting internal inflows and deduped fees.
 *
 * When a blockchain_internal cluster contains multiple wallet addresses involved in
 * related transactions, outflows may include internal transfers to other owned addresses.
 * This function identifies and subtracts those internal inflows to get the actual
 * external transfer amount for matching purposes.
 *
 * NOTE: This only works when the processor creates separate transaction rows for each
 * address (per-address model). If a processor records change within the same row,
 * this adjustment won't apply.
 *
 * When multiple outflows exist for the same asset, sums all outflows to represent
 * the full external transfer for matching.
 *
 * @param assetId - Asset to calculate adjustment for
 * @param group - Transactions connected by blockchain_internal links
 * @param inflowAmountsByTx - Aggregated inflow amounts
 * @param outflowAmountsByTx - Aggregated outflow amounts
 * @returns Transaction ID, adjusted amount, ambiguity flag, and all group member IDs; or skip reason
 */
export function calculateOutflowAdjustment(
  assetId: string,
  group: UniversalTransactionData[],
  inflowAmountsByTx: Map<number, Map<string, Decimal>>,
  outflowAmountsByTx: Map<number, Map<string, Decimal>>
):
  | { adjustedAmount: Decimal; groupMemberIds: number[]; multipleOutflows: boolean; representativeTxId: number }
  | { skip: 'non-positive' | 'no-adjustment' } {
  const outflowTxs = group.filter((tx) => {
    const outflowMap = outflowAmountsByTx.get(tx.id);
    if (!outflowMap) return false;
    const amount = outflowMap.get(assetId);
    return amount ? amount.gt(0) : false;
  });

  const inflowTxs = group.filter((tx) => {
    const inflowMap = inflowAmountsByTx.get(tx.id);
    if (!inflowMap) return false;
    const amount = inflowMap.get(assetId);
    return amount ? amount.gt(0) : false;
  });

  if (outflowTxs.length === 0) return { skip: 'no-adjustment' };

  const multipleOutflows = outflowTxs.length > 1;
  if (inflowTxs.length === 0 && !multipleOutflows) return { skip: 'no-adjustment' };

  const sumGrossMovements = (movements: { assetId: string; grossAmount: Decimal }[] | undefined): Decimal => {
    let total = parseDecimal('0');
    for (const movement of movements ?? []) {
      if (movement.assetId !== assetId) continue;
      total = total.plus(parseDecimal(movement.grossAmount));
    }
    return total;
  };

  // For UTXO chains with multiple inputs/outputs in the same transaction:
  // Sum ALL outflows and subtract ALL inflows (change) to get the true external transfer amount
  // Assign this total to the transaction with the smallest ID for consistency
  let totalOutflows = parseDecimal('0');
  let selectedTx = outflowTxs[0]; // Default to first tx

  for (const tx of outflowTxs) {
    const amount = sumGrossMovements(tx.movements.outflows);
    if (amount.gt(0)) {
      totalOutflows = totalOutflows.plus(amount);
      // Use smallest transaction ID for consistency
      if (!selectedTx || tx.id < selectedTx.id) {
        selectedTx = tx;
      }
    }
  }

  if (!selectedTx) return { skip: 'no-adjustment' };

  // Collect all outflow transaction IDs in this group
  // All outflows for this asset are part of the same UTXO transaction group
  const groupMemberIds: number[] = outflowTxs.map((tx) => tx.id);

  // Sum all internal inflows (change addresses)
  let totalInternalInflows = parseDecimal('0');
  for (const inflowTx of inflowTxs) {
    const amount = sumGrossMovements(inflowTx.movements.inflows);
    if (amount.gt(0)) totalInternalInflows = totalInternalInflows.plus(amount);
  }

  // Deduplicate on-chain fees (per-address processors may record fee per address)
  let feeAmount = parseDecimal('0');
  for (const tx of group) {
    for (const fee of tx.fees ?? []) {
      if (fee.assetId !== assetId) continue;
      if (fee.settlement !== 'on-chain') continue;
      const amount = parseDecimal(fee.amount);
      if (amount.gt(feeAmount)) feeAmount = amount;
    }
  }

  // Total external transfer = sum of all outflows - sum of all inflows (change)
  const adjustedAmount = totalOutflows.minus(totalInternalInflows).minus(feeAmount);
  if (adjustedAmount.lte(0)) return { skip: 'non-positive' };

  return { representativeTxId: selectedTx.id, adjustedAmount, multipleOutflows, groupMemberIds };
}

/**
 * Convert stored transactions to transaction candidates for matching.
 * Creates one candidate per asset movement (not just primary).
 * Uses netAmount for transfer matching (what actually went on-chain).
 *
 * @param transactions - Universal transactions to convert
 * @param amountOverrides - Optional map of adjusted amounts for UTXO internal change
 * @param outflowGroupings - Optional groupings of UTXO outflows (only representative gets a candidate)
 * @returns Array of transaction candidates
 */
/**
 * Detect trades/swaps structurally by movement shape.
 * A transaction with both inflows and outflows in completely disjoint asset sets
 * is a trade (e.g., buy INJ with USDT). These should never produce link candidates.
 *
 * Returns false for:
 * - Pure outflows (withdrawals) or pure inflows (deposits)
 * - Same-asset inflows and outflows (e.g., NEAR storage refunds)
 */
export function isStructuralTrade(tx: UniversalTransactionData): boolean {
  const inflows = tx.movements.inflows ?? [];
  const outflows = tx.movements.outflows ?? [];

  if (inflows.length === 0 || outflows.length === 0) {
    return false;
  }

  const inflowAssets = new Set(inflows.map((m) => m.assetId));
  const outflowAssets = new Set(outflows.map((m) => m.assetId));

  // If any asset appears in both inflows and outflows, there's overlap → not a pure trade
  for (const asset of inflowAssets) {
    if (outflowAssets.has(asset)) {
      return false;
    }
  }

  return true;
}

export function convertToCandidates(
  transactions: UniversalTransactionData[],
  amountOverrides?: Map<number, Map<string, Decimal>>,
  outflowGroupings?: OutflowGrouping[]
): TransactionCandidate[] {
  const candidates: TransactionCandidate[] = [];

  // Helper to check if a transaction/asset is a non-representative group member
  const isNonRepresentativeGroupMember = (txId: number, assetId: string): boolean => {
    if (!outflowGroupings) return false;
    for (const grouping of outflowGroupings) {
      if (grouping.assetId === assetId && grouping.groupMemberIds.has(txId)) {
        // This TX is in a group - only allow the representative
        return txId !== grouping.representativeTxId;
      }
    }
    return false;
  };

  for (const tx of transactions) {
    // Structural trade detection: if a transaction has both inflows and outflows
    // with completely disjoint asset sets, it's a trade/swap — not a transfer.
    // Pure inflows (deposits) and pure outflows (withdrawals) always pass through.
    // Same-asset in+out (e.g., NEAR storage refunds) also passes through.
    if (isStructuralTrade(tx)) {
      continue;
    }

    // Create candidates for all inflows
    for (const inflow of tx.movements.inflows ?? []) {
      const inflowAmount = inflow.netAmount ?? inflow.grossAmount;
      const inflowGrossAmount =
        inflow.netAmount && !inflow.netAmount.eq(inflow.grossAmount) ? inflow.grossAmount : undefined;

      const candidate: TransactionCandidate = {
        id: tx.id,
        externalId: tx.externalId,
        sourceName: tx.source,
        sourceType: tx.sourceType,
        timestamp: new Date(tx.datetime),
        assetId: inflow.assetId,
        assetSymbol: inflow.assetSymbol,
        amount: inflowAmount,
        grossAmount: inflowGrossAmount,
        direction: 'in',
        fromAddress: tx.from,
        toAddress: tx.to,
        blockchainTransactionHash: tx.blockchain?.transaction_hash,
      };
      candidates.push(candidate);
    }

    // Create candidates for all outflows
    for (const outflow of tx.movements.outflows ?? []) {
      // Skip non-representative members of UTXO outflow groups
      // (their amounts are already summed into the representative's adjusted amount)
      if (isNonRepresentativeGroupMember(tx.id, outflow.assetId)) {
        continue;
      }

      const outflowAmount =
        amountOverrides?.get(tx.id)?.get(outflow.assetId) ?? outflow.netAmount ?? outflow.grossAmount;
      const outflowGrossAmount =
        outflow.netAmount && !outflow.netAmount.eq(outflow.grossAmount) ? outflow.grossAmount : undefined;

      const candidate: TransactionCandidate = {
        id: tx.id,
        externalId: tx.externalId,
        sourceName: tx.source,
        sourceType: tx.sourceType,
        timestamp: new Date(tx.datetime),
        assetId: outflow.assetId,
        assetSymbol: outflow.assetSymbol,
        amount: outflowAmount,
        grossAmount: outflowGrossAmount,
        direction: 'out',
        fromAddress: tx.from,
        toAddress: tx.to,
        blockchainTransactionHash: tx.blockchain?.transaction_hash,
      };
      candidates.push(candidate);
    }
  }

  return candidates;
}

/**
 * Separate candidates into sources (outflows) and targets (inflows)
 *
 * @param candidates - Transaction candidates
 * @returns Object with sources and targets arrays
 */
export function separateSourcesAndTargets(candidates: TransactionCandidate[]): {
  sources: TransactionCandidate[];
  targets: TransactionCandidate[];
} {
  const sources: TransactionCandidate[] = [];
  const targets: TransactionCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.direction === 'out') {
      sources.push(candidate);
    } else if (candidate.direction === 'in') {
      targets.push(candidate);
    }
  }

  return { sources, targets };
}
