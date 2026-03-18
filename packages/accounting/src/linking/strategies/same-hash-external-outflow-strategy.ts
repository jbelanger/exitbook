import { err, ok, parseDecimal, type NewTransactionLink, type Result } from '@exitbook/core';
import { Decimal } from 'decimal.js';

import {
  allocateSameHashUtxoAmountInTxOrder,
  planSameHashUtxoSourceCapacities,
  type SameHashUtxoCapacityPlan,
  type SameHashUtxoSourceAllocation,
} from '../../shared/same-hash-utxo-allocation.js';
import { createTransactionLink } from '../matching/link-construction.js';
import { shouldAutoConfirm } from '../matching/match-allocation.js';
import type { LinkableMovement } from '../pre-linking/types.js';
import type {
  MatchingConfig,
  PotentialMatch,
  SameHashExternalSourceAllocation,
  TransactionLinkMetadata,
} from '../shared/types.js';

import { scoreAndFilterMatches } from './amount-timing-utils.js';
import type { ILinkingStrategy, StrategyResult } from './types.js';

interface SameHashExternalOutflowGroup {
  assetId: string;
  hash: string;
  siblingInflows: LinkableMovement[];
  sources: LinkableMovement[];
  toAddress: string;
}

interface ResolvedGroupMatch {
  groupAmount: Decimal;
  groupMatch: PotentialMatch;
  siblingInflowAmount: Decimal;
  sourceAllocations: SameHashUtxoSourceAllocation[];
  status: 'confirmed' | 'suggested';
}

/**
 * Handles multi-input UTXO sends that Exitbook stores as one blockchain outflow per tracked account.
 *
 * The persisted link model is still pairwise, so this strategy:
 * 1. reconstructs the same-hash outflow group amount using a single deduplicated fee
 * 2. finds one exact inbound match for the full group
 * 3. expands that group match back into pairwise partial links
 */
export class SameHashExternalOutflowStrategy implements ILinkingStrategy {
  readonly name = 'same-hash-external-outflow';

  execute(
    sources: LinkableMovement[],
    targets: LinkableMovement[],
    config: MatchingConfig
  ): Result<StrategyResult, Error> {
    const links: NewTransactionLink[] = [];
    const consumedCandidateIds = new Set<number>();
    const now = new Date();
    const exchangeTargets = targets.filter((target) => target.sourceType === 'exchange' && target.direction === 'in');

    for (const group of buildGroups(sources, targets)) {
      const capacityPlanResult = planSameHashUtxoSourceCapacities(
        group.sources.map((source) => ({
          txId: source.transactionId,
          grossAmount: sourceGross(source),
          feeAmount: sourceFee(source),
        }))
      );
      if (capacityPlanResult.isErr()) {
        return err(capacityPlanResult.error);
      }

      const resolvedMatchResult = resolveGroupMatch(group, exchangeTargets, config, capacityPlanResult.value);
      if (resolvedMatchResult.isErr()) {
        return err(resolvedMatchResult.error);
      }
      const resolvedMatch = resolvedMatchResult.value;
      if (!resolvedMatch) continue;

      const allocations = buildSourceAllocations(resolvedMatch.sourceAllocations);
      const feeBearingAllocation =
        allocations.find((allocation) => allocation.feeDeducted !== '0') ??
        [...allocations].sort((left, right) => left.sourceTransactionId - right.sourceTransactionId)[0];
      if (!feeBearingAllocation) continue;
      const expandedMatches = buildExpandedMatches(
        resolvedMatch.groupMatch,
        group.sources,
        resolvedMatch.sourceAllocations
      );

      for (const match of expandedMatches) {
        const linkResult = createTransactionLink(match, resolvedMatch.status, now);
        if (linkResult.isErr()) {
          continue;
        }

        const link = linkResult.value;
        const metadata: TransactionLinkMetadata = {
          ...link.metadata,
          dedupedSameHashFee: capacityPlanResult.value.dedupedFee.toFixed(),
          sameHashExternalGroup: true,
          sameHashExternalGroupAmount: resolvedMatch.groupAmount.toFixed(),
          sameHashExternalGroupSize: group.sources.length,
          feeBearingSourceTransactionId: feeBearingAllocation.sourceTransactionId,
          sameHashExternalSourceAllocations: allocations,
          blockchainTxHash: group.hash,
          sharedToAddress: group.toAddress,
        };
        if (group.siblingInflows.length > 0) {
          metadata.sameHashMixedExternalGroup = true;
          metadata.sameHashTrackedSiblingInflowAmount = resolvedMatch.siblingInflowAmount.toFixed();
          metadata.sameHashTrackedSiblingInflowCount = group.siblingInflows.length;
          metadata.sameHashResidualAllocationPolicy = 'transaction_id_prefix';
        }
        link.metadata = metadata;

        links.push(link);
        consumedCandidateIds.add(match.sourceMovement.id);
      }

      consumedCandidateIds.add(resolvedMatch.groupMatch.targetMovement.id);
    }

    return ok({ links, consumedCandidateIds });
  }
}

function buildGroups(sources: LinkableMovement[], targets: LinkableMovement[]): SameHashExternalOutflowGroup[] {
  const candidateGroups = new Map<string, LinkableMovement[]>();

  for (const source of sources) {
    if (source.sourceType !== 'blockchain') continue;
    if (source.direction !== 'out') continue;
    if (!source.blockchainTxHash) continue;
    if (!source.toAddress) continue;

    const key = `${source.blockchainTxHash}\u0000${source.assetId}`;
    const existing = candidateGroups.get(key) ?? [];
    existing.push(source);
    candidateGroups.set(key, existing);
  }

  const groups: SameHashExternalOutflowGroup[] = [];
  for (const [key, groupSources] of candidateGroups) {
    if (groupSources.length < 2) continue;

    const distinctAccounts = new Set(groupSources.map((source) => source.accountId));
    if (distinctAccounts.size < 2) continue;

    const distinctTxIds = new Set(groupSources.map((source) => source.transactionId));
    if (distinctTxIds.size !== groupSources.length) continue;

    const toAddresses = new Set(
      groupSources.map((source) => source.toAddress).filter((value): value is string => !!value)
    );
    if (toAddresses.size !== 1) continue;

    const [hash, assetId] = key.split('\u0000');
    if (!hash || !assetId) continue;

    const siblingInflows = targets.filter(
      (target) =>
        target.sourceType === 'blockchain' &&
        target.sourceName === groupSources[0]?.sourceName &&
        target.direction === 'in' &&
        target.blockchainTxHash === hash &&
        target.assetId === assetId
    );

    const hasExchangeTargets = targets.some(
      (target) =>
        target.sourceType === 'exchange' &&
        target.direction === 'in' &&
        target.assetSymbol === groupSources[0]?.assetSymbol
    );
    if (!hasExchangeTargets) continue;

    groups.push({
      hash,
      assetId,
      siblingInflows: siblingInflows.sort(
        (left, right) => left.transactionId - right.transactionId || left.id - right.id
      ),
      sources: groupSources.sort((left, right) => left.transactionId - right.transactionId || left.id - right.id),
      toAddress: [...toAddresses][0]!,
    });
  }

  return groups;
}

function resolveGroupMatch(
  group: SameHashExternalOutflowGroup,
  exchangeTargets: LinkableMovement[],
  config: MatchingConfig,
  sourceCapacityPlan: SameHashUtxoCapacityPlan
): Result<ResolvedGroupMatch | undefined, Error> {
  const siblingInflowAmount = sumMovementGrossAmounts(group.siblingInflows);
  const totalSourceCapacity = sourceCapacityPlan.totalCapacity;
  if (siblingInflowAmount.gt(totalSourceCapacity)) {
    return ok(undefined);
  }

  const groupAmount = totalSourceCapacity.minus(siblingInflowAmount);
  if (groupAmount.lte(0)) {
    return ok(undefined);
  }

  const sourceAllocations = allocateSameHashUtxoAmountInTxOrder(sourceCapacityPlan.capacities, groupAmount);
  if (!sourceAllocations) {
    return ok(undefined);
  }

  const requireAddressMatch = group.siblingInflows.length > 0;
  const syntheticSource = buildSyntheticSource(group, groupAmount);
  const exactMatches = scoreAndFilterMatches(syntheticSource, exchangeTargets, config).filter((match) => {
    if (!match.targetMovement.amount.eq(groupAmount)) {
      return false;
    }

    if (!requireAddressMatch) {
      return match.matchCriteria.amountSimilarity.eq(1);
    }

    return targetEndpointMatchesAddress(group.toAddress, match.targetMovement);
  });

  if (exactMatches.length !== 1) {
    return ok(undefined);
  }

  const groupMatch = exactMatches[0]!;
  return ok({
    groupAmount,
    groupMatch,
    siblingInflowAmount,
    sourceAllocations,
    status:
      group.siblingInflows.length > 0 ? 'suggested' : shouldAutoConfirm(groupMatch, config) ? 'confirmed' : 'suggested',
  });
}

function buildSyntheticSource(group: SameHashExternalOutflowGroup, amount: Decimal): LinkableMovement {
  const representative = group.sources[0]!;
  const grossAmount = syntheticGross(group.sources);

  return {
    ...representative,
    amount,
    grossAmount: grossAmount.eq(amount) ? undefined : grossAmount,
  };
}

function buildExpandedMatches(
  groupMatch: PotentialMatch,
  sources: LinkableMovement[],
  sourceAllocations: SameHashUtxoSourceAllocation[]
): PotentialMatch[] {
  const allocationsByTxId = new Map(sourceAllocations.map((allocation) => [allocation.txId, allocation] as const));

  return sources.flatMap((source) => {
    const allocation = allocationsByTxId.get(source.transactionId);
    if (!allocation || allocation.allocatedAmount.lte(0)) {
      return [];
    }

    return [
      {
        ...groupMatch,
        sourceMovement: {
          ...source,
          amount: allocation.capacityAmount,
        },
        consumedAmount: allocation.allocatedAmount,
      },
    ];
  });
}

function buildSourceAllocations(sourceAllocations: SameHashUtxoSourceAllocation[]): SameHashExternalSourceAllocation[] {
  return sourceAllocations.map((allocation) => {
    const unlinkedAmount = allocation.unallocatedAmount;

    return {
      sourceTransactionId: allocation.txId,
      grossAmount: allocation.grossAmount.toFixed(),
      linkedAmount: allocation.allocatedAmount.toFixed(),
      feeDeducted: allocation.feeDeducted.toFixed(),
      ...(unlinkedAmount.gt(0) ? { unlinkedAmount: unlinkedAmount.toFixed() } : {}),
    };
  });
}

function sourceGross(source: LinkableMovement): Decimal {
  return source.grossAmount ?? source.amount;
}

function sourceFee(source: LinkableMovement): Decimal {
  return sourceGross(source).minus(source.amount);
}

function syntheticGross(sources: LinkableMovement[]): Decimal {
  return sources.reduce((sum, source) => sum.plus(sourceGross(source)), parseDecimal('0'));
}

function sumMovementGrossAmounts(movements: LinkableMovement[]): Decimal {
  return movements.reduce((sum, movement) => sum.plus(sourceGross(movement)), parseDecimal('0'));
}

function targetEndpointMatchesAddress(expectedAddress: string, target: LinkableMovement): boolean {
  const normalizedAddress = expectedAddress.toLowerCase();

  return (
    target.toAddress?.toLowerCase() === normalizedAddress || target.fromAddress?.toLowerCase() === normalizedAddress
  );
}
