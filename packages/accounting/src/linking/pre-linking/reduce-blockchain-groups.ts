import type { Currency } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

import type { SameHashAssetGroup, SameHashParticipant } from './group-same-hash-transactions.js';
import type { PendingInternalLink } from './types.js';

/**
 * Result of reducing same-hash blockchain groups.
 */
export interface BlockchainGroupReduction {
  /** Conservative blockchain_internal links for clearly internal transfers */
  internalLinks: PendingInternalLink[];

  /**
   * Outflow amount reductions keyed by txId → assetId → reduced amount.
   * Only populated for clearly internal cases.
   */
  outflowReductions: Map<number, Map<string, Decimal>>;

  /**
   * Transaction IDs that are part of internal groups (for marking isInternal on linkable movements).
   */
  internalTxIds: Set<number>;
}

/**
 * Reduce same-hash blockchain groups conservatively.
 *
 * Rules:
 * 1. Only outflows, no inflows → external send, no special handling
 * 2. Exactly one pure outflow participant + pure inflow participants → clearly internal
 * 3. Multiple outflow participants + inflow participants → ambiguous, skip with warning
 * 4. Mixed inflow/outflow on same participant → ambiguous, skip with warning
 */
export function reduceBlockchainGroups(groups: SameHashAssetGroup[], logger: Logger): BlockchainGroupReduction {
  const internalLinks: PendingInternalLink[] = [];
  const outflowReductions = new Map<number, Map<string, Decimal>>();
  const internalTxIds = new Set<number>();
  const now = new Date();

  for (const group of groups) {
    const pureOutflows: SameHashParticipant[] = [];
    const pureInflows: SameHashParticipant[] = [];
    const mixed: SameHashParticipant[] = [];

    for (const p of group.participants) {
      const hasInflow = p.inflowGrossAmount.gt(0);
      const hasOutflow = p.outflowGrossAmount.gt(0);

      if (hasInflow && hasOutflow) {
        mixed.push(p);
      } else if (hasOutflow) {
        pureOutflows.push(p);
      } else if (hasInflow) {
        pureInflows.push(p);
      }
    }

    // Rule 1: Only outflows — external multi-input send, no action
    if (pureInflows.length === 0 && mixed.length === 0) {
      continue;
    }

    // Rule 4: Mixed inflow/outflow on same participant — ambiguous
    if (mixed.length > 0) {
      logger.warn(
        {
          hash: group.normalizedHash,
          blockchain: group.blockchain,
          assetId: group.assetId,
          asset: group.assetSymbol,
          mixedTxIds: mixed.map((p) => p.txId),
        },
        'Ambiguous same-hash group: participant has both inflows and outflows for same asset'
      );
      continue;
    }

    // Rule 3: Multiple outflows + inflows — ambiguous
    if (pureOutflows.length > 1) {
      logger.warn(
        {
          hash: group.normalizedHash,
          blockchain: group.blockchain,
          assetId: group.assetId,
          asset: group.assetSymbol,
          outflowTxIds: pureOutflows.map((p) => p.txId),
          inflowTxIds: pureInflows.map((p) => p.txId),
        },
        'Ambiguous same-hash group: multiple outflow participants with inflows present'
      );
      continue;
    }

    // Rule 2: Exactly one pure outflow + pure inflows — clearly internal
    const sender = pureOutflows[0];
    if (pureOutflows.length === 1 && pureInflows.length > 0 && sender) {
      if (sender.outflowMovementCount !== 1 || pureInflows.some((receiver) => receiver.inflowMovementCount !== 1)) {
        logger.warn(
          {
            hash: group.normalizedHash,
            blockchain: group.blockchain,
            assetId: group.assetId,
            asset: group.assetSymbol,
            senderTxId: sender.txId,
            senderOutflowMovementCount: sender.outflowMovementCount,
            receiverMovementCounts: pureInflows.map((receiver) => ({
              txId: receiver.txId,
              inflowMovementCount: receiver.inflowMovementCount,
            })),
          },
          'Ambiguous same-hash group: participant has multiple movements for the same asset'
        );
        continue;
      }

      // Mark all participants as internal
      internalTxIds.add(sender.txId);
      for (const receiver of pureInflows) {
        internalTxIds.add(receiver.txId);
      }

      // Generate internal links: sender → each receiver
      for (const receiver of pureInflows) {
        if (sender.accountId === receiver.accountId) continue;

        internalLinks.push({
          sourceTransactionId: sender.txId,
          targetTransactionId: receiver.txId,
          assetSymbol: group.assetSymbol as Currency,
          sourceAssetId: sender.assetId,
          targetAssetId: receiver.assetId,
          sourceAmount: sender.outflowGrossAmount,
          targetAmount: receiver.inflowGrossAmount,
          linkType: 'blockchain_internal',
          confidenceScore: parseDecimal('1.0'),
          matchCriteria: {
            assetMatch: true,
            amountSimilarity: parseDecimal('1.0'),
            timingValid: true,
            timingHours: 0,
            addressMatch: undefined,
          },
          status: 'confirmed',
          reviewedBy: 'auto',
          reviewedAt: now,
          createdAt: now,
          updatedAt: now,
          metadata: {
            blockchainTxHash: group.normalizedHash,
            blockchain: group.blockchain,
          },
        });
      }

      // Compute outflow reduction: subtract tracked inflows + deduped on-chain fee
      let totalInflows = parseDecimal('0');
      for (const receiver of pureInflows) {
        totalInflows = totalInflows.plus(receiver.inflowGrossAmount);
      }

      // Deduplicate fees: take the max fee across all participants
      let dedupedFee = parseDecimal('0');
      for (const p of group.participants) {
        if (p.onChainFeeAmount.gt(dedupedFee)) {
          dedupedFee = p.onChainFeeAmount;
        }
      }

      const reducedAmount = sender.outflowGrossAmount.minus(totalInflows).minus(dedupedFee);

      if (reducedAmount.gt(0)) {
        const byAsset = outflowReductions.get(sender.txId) ?? new Map<string, Decimal>();
        byAsset.set(group.assetId, reducedAmount);
        outflowReductions.set(sender.txId, byAsset);
      }
    }
  }

  return { internalLinks, outflowReductions, internalTxIds };
}
